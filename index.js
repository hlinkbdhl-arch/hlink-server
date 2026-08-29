const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

let sock;
let currentQR = null;
let isConnected = false;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      isConnected = false;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      isConnected = false;
      currentQR = null;
      if (shouldReconnect) {
        startWhatsApp();
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      console.log('WhatsApp Connected Successfully!');
    }
  });
}

startWhatsApp();

// স্ট্যাটাস ও আসল QR কোড চেক API
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, qr: currentQR });
});

// স্বয়ংক্রিয় মেসেজ ও ছবি পাঠানোর API
app.post('/send-message', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(400).json({ success: false, error: 'WhatsApp সংযুক্ত নেই! আগে QR স্ক্যান করুন।' });
    }

    let { phone, message, imageUrl } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'ফোন নম্বর প্রদান করা হয়নি।' });
    }

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) {
      phone = '88' + phone;
    }
    const jid = `${phone}@s.whatsapp.net`;

    if (imageUrl) {
      await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: message || ''
      });
    } else {
      await sock.sendMessage(jid, { text: message || '' });
    }

    res.json({ success: true, message: `Sent to ${phone}` });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
