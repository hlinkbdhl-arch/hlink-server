const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ limit: '80mb', extended: true }));

const ID_INSTANCE = "710722723219";
const API_TOKEN = "d0b8921961794ccbbaa58e5a08775e7369e4a44b3146453d98";
const GREEN_API_URL = "https://7107.api.greenapi.com";

app.get('/status', (req, res) => {
  res.json({ success: true, message: 'Server is Live & Ready!' });
});

app.post('/send-bulk', async (req, res) => {
  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone missing' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const chatId = `${phone}@c.us`;

    // ছবি থাকলে পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        const form = new FormData();
        form.append('chatId', chatId);
        form.append('file', buffer, { 
          filename: images[i].name || `image_${i+1}.jpg`,
          contentType: 'image/jpeg'
        });

        // ১ম ছবির সাথেই ক্যাপশন পাঠানো
        if (i === 0 && message) {
          form.append('caption', message);
        }

        await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendFileByUpload/${API_TOKEN}`, form, {
          headers: form.getHeaders(),
          timeout: 25000
        });

        // একাধিক ছবির মাঝে সেফ বিরতি
        if (i < images.length - 1) {
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ পাঠানো
      await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
        chatId: chatId,
        message: message
      }, { timeout: 15000 });
    }

    res.json({ success: true, message: `Delivered to ${phone}` });
  } catch (err) {
    console.error('Delivery Error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
