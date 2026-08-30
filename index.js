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

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Mac OS', 'Chrome', '124.0.6367.207'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = await QRCode.toDataURL(qr);
        isConnected = false;
        console.log('🔄 New QR Code Generated');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        isConnected = false;
        console.log(`Connection closed (Code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          setTimeout(startWhatsApp, 3000);
        } else {
          currentQR = null;
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        console.log('🎉 WhatsApp Engine Linked & Live!');
      }
    });
  } catch (err) {
    console.error('Socket Boot Error:', err);
    setTimeout(startWhatsApp, 5000);
  }
}

startWhatsApp();

app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    qr: currentQR
  });
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected, message: 'Server is running' });
});

// সরাসরি আনলিমিটেড বাল্ক মেসেজ ও ছবি সেন্ডিং রাউট
app.post('/send-bulk', async (req, res) => {
  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর দেওয়া হয়নি' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.length === 10 && phone.startsWith('1')) phone = '880' + phone;
    else if (phone.length === 11 && phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    if (!sock) {
      return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ সকেট ইঞ্জিন ইনিশিয়ালাইজ হয়নি।' });
    }

    // ছবি থাকলে পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(cleanBase64, 'base64');

        await sock.sendMessage(jid, {
          image: imageBuffer,
          mimetype: 'image/jpeg'
        });

        if (i < images.length - 1) {
          await delay(2000);
        }
      }

      // ছবির পরপরই সম্পূর্ণ বড় মেসেজ
      if (message && message.trim().length > 0) {
        await delay(1500);
        await sock.sendMessage(jid, { text: message });
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ
      await sock.sendMessage(jid, { text: message });
    }

    console.log(`✅ Message Sent to: ${phone}`);
    res.json({ success: true, message: `Delivered to ${phone}` });
  } catch (err) {
    console.error(`❌ Send Error for ${req.body?.phone}:`, err);
    res.status(500).json({ success: false, error: err.message || 'মেসেজ ডেলিভারি ব্যর্থ হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Unlimited WhatsApp Server running on port ${PORT}`));
