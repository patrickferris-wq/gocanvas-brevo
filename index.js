const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BREVO_CUSTOMER_LIST_ID = Number(process.env.BREVO_CUSTOMER_LIST_ID);

app.get("/", (_req, res) => {
  res.send("GoCanvas/Brevo webhook is running.");
});

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractEmailFromXml(xml) {
  if (!xml || typeof xml !== "string") {
    return "";
  }

  const pattern =
    /<Label>\s*Email:?\s*<\/Label>[\s\S]*?<Value>\s*([^<]+?)\s*<\/Value>/i;

  const match = xml.match(pattern);
  if (!match) {
    return "";
  }

  return decodeXmlEntities(match[1]);
}

async function fetchGoCanvasSubmission(submissionId) {
  const apiKey = process.env.GOCANVAS_API_KEY;
  const username = process.env.GOCANVAS_USERNAME;

  if (!apiKey || !username) {
    throw new Error("Missing GOCANVAS_API_KEY or GOCANVAS_USERNAME");
  }

  const url = `https://www.gocanvas.com/apiv2/submissions/${submissionId}.json`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, application/xml, text/xml, */*",
    },
    params: {
      username,
    },
    timeout: 30000,
  });

  if (typeof response.data === "string") {
    return response.data;
  }

  return JSON.stringify(response.data);
}

async function upsertBrevoContact(email) {
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (!brevoApiKey) {
    throw new Error("Missing BREVO_API_KEY");
  }

  if (!BREVO_CUSTOMER_LIST_ID) {
    throw new Error("Missing BREVO_CUSTOMER_LIST_ID");
  }

  await axios.post(
    "https://api.brevo.com/v3/contacts",
    {
      email,
      listIds: [BREVO_CUSTOMER_LIST_ID],
      updateEnabled: true,
    },
    {
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    }
  );
}

app.post("/gocanvas-webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    const submissionId = req.body?.submission?.id;

    if (!submissionId) {
      console.log("No submission ID in payload.");
      return res.status(200).send("Received");
    }

    let submissionXml;

    try {
      submissionXml = await fetchGoCanvasSubmission(submissionId);
      console.log("Full submission fetched:");
      console.log(submissionXml.slice(0, 4000));
    } catch (err) {
      console.error("Failed to fetch submission:");
      console.error(err.response?.data || err.message);
      return res.status(200).send("Fetch failed");
    }

    const email = extractEmailFromXml(submissionXml);

    if (!email) {
      console.log('Field "Email" not found in submission data.');
      return res.status(200).send('Received, but field "Email" not found');
    }

    console.log("Email found:", email);

    await upsertBrevoContact(email);

    console.log("Contact updated in Brevo Customers list.");
    return res.status(200).send("Success");
  } catch (err) {
    console.error("Webhook handler error:");
    console.error(err.response?.data || err.message);
    return res.status(500).send("Server error");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
