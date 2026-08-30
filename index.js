const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
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
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = await QRCode.toDataURL(qr);
        isConnected = false;
        console.log('🔄 New QR Code Generated!');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        isConnected = false;
        console.log('Connection closed. Reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(startWhatsApp, 3000);
        } else {
          currentQR = null;
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        console.log('✅ WhatsApp Engine Connected Successfully!');
      }
    });
  } catch (err) {
    console.error('Socket Init Error:', err);
    setTimeout(startWhatsApp, 5000);
  }
}

startWhatsApp();

// QR ও স্ট্যাটাস রুট
app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    qr: currentQR
  });
});

// ফোর্স QR রিস্টার্ট রুট
app.get('/restart-qr', async (req, res) => {
  startWhatsApp();
  res.json({ success: true, message: 'Restarting WhatsApp Socket...' });
});

// বাল্ক মেসেজ ও ছবি সেন্ডিং রুট
app.post('/send-bulk', async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ এখনও কানেক্ট করা হয়নি! আগে QR স্ক্যান করুন।' });
  }

  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর দেওয়া হয়নি' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    // ছবি পাঠানো
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

      // ছবির সাথে মেসেজ পাঠানো
      if (message && message.trim().length > 0) {
        await delay(1200);
        await sock.sendMessage(jid, { text: message });
      }
    } else if (message) {
      await sock.sendMessage(jid, { text: message });
    }

    res.json({ success: true, message: `Delivered to ${phone}` });
  } catch (err) {
    console.error('Send Bulk Error:', err);
    res.status(500).json({ success: false, error: err.message || 'মেসেজ পাঠানো ব্যর্থ হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Unlimited WhatsApp Server running on port ${PORT}`));
