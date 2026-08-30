const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let sock;
let qrCodeImage = null;
let isConnected = false;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['H Link bd Engine', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeImage = await QRCode.toDataURL(qr);
      isConnected = false;
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      isConnected = false;
      if (shouldReconnect) {
        startWhatsApp();
      }
    } else if (connection === 'open') {
      isConnected = true;
      qrCodeImage = null;
      console.log('✅ WhatsApp Free Engine Connected Successfully!');
    }
  });
}

startWhatsApp();

// স্ট্যাটাস ও QR কোড রুট
app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    qr: qrCodeImage
  });
});

// ১০০% ফ্রি আনলিমিটেড বাল্ক মেসেজ ও ছবি সেন্ডিং রুট
app.post('/send-bulk', async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ কানেক্টেড নেই! আগে QR স্ক্যান করুন।' });
  }

  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর দেওয়া হয়নি' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    // ছবি থাকলে পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        await sock.sendMessage(jid, {
          image: buffer
        });

        if (i < images.length - 1) {
          await delay(2000);
        }
      }

      // ছবির পরপরই সম্পূর্ণ বড় মেসেজ পাঠানো
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
    console.error('Send Error:', err);
    res.status(500).json({ success: false, error: err.message || 'ডেলিভারি ব্যর্থ হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Unlimited Free WhatsApp Server running on port ${PORT}`));
