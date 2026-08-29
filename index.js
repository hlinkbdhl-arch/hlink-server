const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let sock;
let currentQR = null;
let isConnected = false;

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQR = await QRCode.toDataURL(qr);
          isConnected = false;
        } catch (err) {
          console.error('QR Error:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        isConnected = false;
        currentQR = null;
        if (shouldReconnect) {
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        console.log('✅ H Link bd WhatsApp Engine Connected Successfully!');
      }
    });
  } catch (e) {
    console.error('Startup Error:', e);
    setTimeout(startWhatsApp, 5000);
  }
}

startWhatsApp();

// ১. স্ট্যাটাস চেক
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, qr: currentQR });
});

// ২. Pairing Code (মোবাইলের জন্য লিংক করার সবচেয়ে সহজ উপায়)
app.get('/pair', async (req, res) => {
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;

    if (!sock) return res.status(500).json({ error: 'Socket not initialized' });

    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(phone);
      return res.json({ code: code });
    } else {
      return res.json({ connected: true });
    }
  } catch (err) {
    console.error('Pairing Error:', err);
    res.status(500).json({ error: err.message || 'Pairing error' });
  }
});

// ৩. একাধিক ছবি এবং টেক্সট মেসেজ একযোগে পাঠানোর API
app.post('/send-bulk', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(400).json({ success: false, error: 'WhatsApp সংযুক্ত নেই! আগে কানেক্ট করুন।' });
    }

    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর প্রয়োজন' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    const jid = `${phone}@s.whatsapp.net`;

    // ছবি পাঠানো (যদি থাকে)
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i];
        const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        
        // শেষ ছবির সাথে মেসেজ ক্যাপশন হিসেবে যাবে
        if (i === images.length - 1 && message) {
          await sock.sendMessage(jid, { image: buffer, caption: message });
        } else {
          await sock.sendMessage(jid, { image: buffer });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ পাঠানো
      await sock.sendMessage(jid, { text: message });
    }

    res.json({ success: true, message: `Sent to ${phone}` });
  } catch (err) {
    console.error('Send Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
