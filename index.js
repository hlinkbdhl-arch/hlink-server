const express = require('express');
const cors = require('cors');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  delay 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let sock = null;
let currentQR = null;
let isConnected = false;
let isInitializing = false;

async function startWhatsApp() {
  if (isInitializing) return;
  isInitializing = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Mac OS', 'Chrome', '124.0.6367.207'],
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = await QRCode.toDataURL(qr);
        isConnected = false;
        console.log('✅ Fresh Live QR Code Ready!');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        isConnected = false;
        isInitializing = false;
        console.log(`Connection closed (Code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          setTimeout(startWhatsApp, 4000);
        } else {
          currentQR = null;
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        isInitializing = false;
        console.log('🎉 WhatsApp Engine Linked & Live!');
      }
    });
  } catch (err) {
    console.error('Socket Boot Error:', err);
    isInitializing = false;
    setTimeout(startWhatsApp, 5000);
  }
}

// ইঞ্জিন বুট
startWhatsApp();

// QR ও কানেকশন স্ট্যাটাস এন্ডপয়েন্ট
app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    qr: currentQR
  });
});

// ফোর্স রিস্টার্ট
app.get('/restart-qr', (req, res) => {
  isInitializing = false;
  startWhatsApp();
  res.json({ success: true, message: 'Re-initializing WhatsApp Socket...' });
});

// আনলিমিটেড বাল্ক মেসেজ ও ছবি সেন্ডিং
app.post('/send-bulk', async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ এখনও কানেক্ট করা হয়নি! আগে QR স্ক্যান করুন।' });
  }

  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর প্রদান করা হয়নি' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    // ছবি থাকলে আগে পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        await sock.sendMessage(jid, { image: buffer });

        if (i < images.length - 1) {
          await delay(2000);
        }
      }

      // ছবির পরপরই সম্পূর্ণ বড় মেসেজটি পাঠানো
      if (message && message.trim().length > 0) {
        await delay(1200);
        await sock.sendMessage(jid, { text: message });
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ পাঠানো
      await sock.sendMessage(jid, { text: message });
    }

    res.json({ success: true, message: `Delivered to ${phone}` });
  } catch (err) {
    console.error('Delivery Error:', err);
    res.status(500).json({ success: false, error: err.message || 'মেসেজ পাঠানো ব্যর্থ হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Unlimited WhatsApp Server running on port ${PORT}`));
