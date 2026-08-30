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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let sock = null;
let currentQR = null;
let isConnected = false;
let isConnecting = false;

async function startWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['HLink-Engine', 'Chrome', '120.0.0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: false,
      fireInitQueries: false
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
        isConnecting = false;
        
        console.log(`Connection closed: ${statusCode}. Reconnecting: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          setTimeout(startWhatsApp, 3000);
        } else {
          currentQR = null;
          setTimeout(startWhatsApp, 3000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        currentQR = null;
        isConnecting = false;
        console.log('✅ WhatsApp Engine Linked & Live!');
      }
    });
  } catch (err) {
    console.error('Socket Boot Error:', err);
    isConnecting = false;
    setTimeout(startWhatsApp, 5000);
  }
}

// ইঞ্জিন স্টার্ট
startWhatsApp();

// সার্ভার যাতে ঘুমিয়ে না পড়ে (Keep Alive Ping)
setInterval(() => {
  if (sock && isConnected) {
    sock.sendPresenceUpdate('available').catch(() => {});
  }
}, 25000);

app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    qr: currentQR
  });
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

// ১০০% ক্র্যাশ-প্রুফ আনলিমিটেড সেন্ডিং রাউট (হাজার হাজার নম্বরে পাঠানো যাবে)
app.post('/send-bulk', async (req, res) => {
  if (!sock || !isConnected) {
    return res.status(500).json({ success: false, error: 'হোয়াটসঅ্যাপ সংযুক্ত নয়।' });
  }

  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর পাওয়া যায়নি' });

    phone = String(phone).replace(/[^0-9]/g, '');
    
    // বাংলাদেশি নম্বরের অটো ফরম্যাটিং
    if (phone.length === 10 && phone.startsWith('1')) phone = '880' + phone;
    else if (phone.length === 11 && phone.startsWith('01')) phone = '88' + phone;

    const jid = `${phone}@s.whatsapp.net`;

    // নম্বরটি WhatsApp-এ আছে কি না নিরাপদে চেক করা (ইনভ্যালিড নম্বরে ক্র্যাশ আটকাবে)
    try {
      const [result] = await sock.onWhatsApp(jid);
      if (!result || !result.exists) {
        return res.status(400).json({ success: false, error: 'নম্বরটিতে হোয়াটসঅ্যাপ নেই' });
      }
    } catch (e) {
      // চেকিং ফেইল হলেও সেন্ড করার চেষ্টা করবে
    }

    // ১. ছবি পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        let base64String = typeof images[i] === 'string' ? images[i] : (images[i].base64 || '');
        if (base64String) {
          const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, '');
          const imgBuffer = Buffer.from(cleanBase64, 'base64');

          await sock.sendMessage(jid, { 
            image: imgBuffer,
            caption: (i === 0 && message) ? String(message) : undefined 
          });

          if (i < images.length - 1) {
            await delay(1500);
          }
        }
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ
      await sock.sendMessage(jid, { text: String(message) });
    }

    res.json({ success: true, message: `Sent to ${phone}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'ডেলিভারি ব্যর্থ হয়েছে' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Unlimited WhatsApp Engine running on port ${PORT}`));
