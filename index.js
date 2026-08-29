const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let sock = null;
let currentQR = null;
let isConnected = false;

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'), // WhatsApp কর্তৃক স্বীকৃত ডেস্কটপ ব্রাউজার
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQR = await QRCode.toDataURL(qr);
          isConnected = false;
        } catch (err) {
          console.error('QR Generate Error:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        isConnected = false;
        currentQR = null;

        if (statusCode === DisconnectReason.loggedOut) {
          // লগআউট হলে পুরনো ক্যাশ মুছে ফেলা
          try {
            fs.rmSync('baileys_auth_info', { recursive: true, force: true });
          } catch (e) {}
        }

        if (shouldReconnect) {
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        console.log('✅ H Link bd WhatsApp Engine Connected Successfully!');
      }
    });
  } catch (err) {
    console.error('Startup Error:', err);
    setTimeout(startWhatsApp, 5000);
  }
}

startWhatsApp();

// ১. স্ট্যাটাস চেক API
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, qr: currentQR });
});

// ২. ফ্রেশ ও ইনস্ট্যান্ট পেয়ারিং কোড API
app.get('/pair', async (req, res) => {
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'ফোন নম্বর প্রদান করুন' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) {
      phone = '88' + phone;
    } else if (!phone.startsWith('880')) {
      phone = '880' + phone;
    }

    if (isConnected) {
      return res.json({ connected: true });
    }

    if (!sock) {
      await startWhatsApp();
      await delay(2000);
    }

    if (!sock.authState.creds.registered) {
      await delay(1500);
      const code = await sock.requestPairingCode(phone);
      return res.json({ code: code });
    } else {
      return res.json({ connected: true });
    }
  } catch (err) {
    console.error('Pairing Code Request Error:', err);
    res.status(500).json({ error: 'কোড পেতে সমস্যা হয়েছে, দয়া করে ৫ সেকেন্ড পর আবার চেষ্টা করুন।' });
  }
});

// ৩. একাধিক ছবি এবং টেক্সট মেসেজ পাঠানোর API
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

    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i];
        const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        
        if (i === images.length - 1 && message) {
          await sock.sendMessage(jid, { image: buffer, caption: message });
        } else {
          await sock.sendMessage(jid, { image: buffer });
        }
        await delay(1000);
      }
    } else if (message) {
      await sock.sendMessage(jid, { text: message });
    }

    res.json({ success: true, message: `Sent to ${phone}` });
  } catch (err) {
    console.error('Send Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 H Link bd Engine live on port ${PORT}`));
