const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("GoCanvas/Brevo webhook is running.");
});

app.post("/gocanvas-webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    const email = req.body.email || req.body.Email || "";
    const firstName = req.body.first_name || req.body["First Name"] || "";
    const lastName = req.body.last_name || req.body["Last Name"] || "";
    const phone = req.body.phone || req.body.Phone || "";

    if (!email) {
      return res.status(400).send("No email found");
    }

    await axios.post(
      "https://api.brevo.com/v3/contacts",
      {
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          PHONE: phone
        },
        updateEnabled: true
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.status(200).send("OK");
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});