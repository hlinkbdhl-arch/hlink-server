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
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = await QRCode.toDataURL(qr);
        isConnected = false;
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error?.output?.statusCode) !== DisconnectReason.loggedOut;
        isConnected = false;
        if (shouldReconnect) setTimeout(startWhatsApp, 3000);
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        console.log('✅ WhatsApp Connected Successfully!');
      }
    });
  } catch (err) {
    console.error('Init Error:', err);
    setTimeout(startWhatsApp, 5000);
  }
}

startWhatsApp();

app.get('/qr', (req, res) => {
  res.json({ connected: isConnected, qr: currentQR });
});

app.post('/send-bulk', async (req, res) => {
  if (!sock || !isConnected) {
    return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ কানেক্টেড নয়।' });
  }

  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'নম্বর পাওয়া যায়নি' });

    phone = String(phone).replace(/[^0-9]/g, '');
    if (phone.length === 10 && phone.startsWith('1')) phone = '880' + phone;
    else if (phone.length === 11 && phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    // ছবি ও ক্যাপশন পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Str = typeof images[i] === 'string' ? images[i] : (images[i].base64 || '');
        if (base64Str) {
          const cleanBase64 = base64Str.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');

          await sock.sendMessage(jid, { 
            image: buffer,
            caption: (i === 0 && message) ? message : undefined 
          });

          if (i < images.length - 1) await delay(1500);
        }
      }
    } else if (message) {
      await sock.sendMessage(jid, { text: String(message) });
    }

    res.json({ success: true, message: `Sent to ${phone}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'ফেল্ড হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
