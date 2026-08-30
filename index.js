const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const ID_INSTANCE = "710722723219";
const API_TOKEN = "d0b8921961794ccbbaa58e5a08775e7369e4a44b3146453d98";
const GREEN_API_URL = "https://7107.api.greenapi.com";

app.get('/status', (req, res) => {
  res.json({ success: true, message: 'Server is Active & Ready!' });
});

app.get('/check-device', async (req, res) => {
  try {
    const response = await axios.get(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/getStateInstance/${API_TOKEN}`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post('/send-bulk', async (req, res) => {
  try {
    let { phone, message, images } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'ফোন নম্বর দেওয়া হয়নি' });

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('01')) phone = '88' + phone;
    else if (!phone.startsWith('880')) phone = '880' + phone;

    const chatId = `${phone}@c.us`;
    let apiResponses = [];

    // ১. ছবি থাকলে আগে ছবিগুলো পাঠানো
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].base64 || images[i];
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        const form = new FormData();
        form.append('chatId', chatId);
        form.append('file', buffer, { 
          filename: images[i].name || `product_${i+1}.jpg`,
          contentType: 'image/jpeg'
        });

        const imgRes = await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendFileByUpload/${API_TOKEN}`, form, {
          headers: form.getHeaders(),
          timeout: 45000
        });

        apiResponses.push(imgRes.data);

        // একাধিক ছবির মধ্যে সেফ বিরতি
        if (i < images.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // ছবির পরপরই সম্পূর্ণ বড় মেসেজটি পাঠানো
      if (message && message.trim().length > 0) {
        await new Promise(r => setTimeout(r, 1000));
        const textRes = await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
          chatId: chatId,
          message: message
        }, { timeout: 20000 });

        apiResponses.push(textRes.data);
      }
    } else if (message) {
      // শুধু টেক্সট থাকলে সরাসরি পাঠানো
      const textRes = await axios.post(`${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN}`, {
        chatId: chatId,
        message: message
      }, { timeout: 20000 });

      apiResponses.push(textRes.data);
    }

    res.json({ success: true, phone: phone, apiData: apiResponses });
  } catch (err) {
    const errorDetails = err.response ? err.response.data : err.message;
    console.error('Send Error:', errorDetails);
    res.status(500).json({ success: false, error: errorDetails });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
