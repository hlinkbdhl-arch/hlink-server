const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const ID_INSTANCE = "710722723219";
const API_TOKEN = "d0b8921961794ccbbaa58e5a08775e7369e4a44b3146453d98";
const GREEN_API_URL = "https://7107.api.greenapi.com";

// হেলথ চেক রুট
app.get('/status', (req, res) => {
  res.json({ success: true, message: 'H Link bd Server is Active & Connected!' });
});

// মেসেজ ও ছবি পাঠানোর রুট
app.post('/send-bulk', async (req, res) => {
  try {
    let { phone, message, images } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'ফোন নম্বর প্রদান করা হয়নি' });
    }

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) {
      phone = '88' + phone;
    } else if (!phone.startsWith('880')) {
      phone = '880' + phone;
    }
    const chatId = `${phone}@c.us`;

    // ছবি থাকলে ছবি পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        const form = new FormData();
        form.append('chatId', chatId);
        form.append('file', buffer, { filename: images[i].name || `image_${i+1}.jpg` });

        if (i === images.length - 1 && message) {
          form.append('caption', message);
        }

        await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendFileByUpload/${API_TOKEN}`, form, {
          headers: form.getHeaders()
        });

        await new Promise(r => setTimeout(r, 1200));
      }
    } else if (message) {
      // শুধু টেক্সট মেসেজ পাঠানো
      await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
        chatId: chatId,
        message: message
      });
    }

    res.json({ success: true, message: `Sent successfully to ${phone}` });
  } catch (err) {
    console.error('Send Error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
