// /index.js
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BREVO_CUSTOMER_LIST_ID = Number(process.env.BREVO_CUSTOMER_LIST_ID);

app.get("/", (_req, res) => {
  res.send("GoCanvas/Brevo webhook is running.");
});

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findEmailInGoCanvasJson(node) {
  if (!node) return "";

  if (Array.isArray(node)) {
    for (const item of node) {
      const email = findEmailInGoCanvasJson(item);
      if (email) return email;
    }
    return "";
  }

  if (typeof node !== "object") {
    return "";
  }

  const label = typeof node.Label === "string" ? node.Label.trim() : "";
  const value = typeof node.Value === "string" ? node.Value.trim() : "";

  if (label === "Email" && value) {
    return value;
  }

  for (const key of Object.keys(node)) {
    const email = findEmailInGoCanvasJson(node[key]);
    if (email) return email;
  }

  return "";
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
      Accept: "application/json",
    },
    params: { username },
    timeout: 30000,
  });

  return response.data;
}

async function upsertBrevoContact(email) {
  if (!process.env.BREVO_API_KEY) {
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
        "api-key": process.env.BREVO_API_KEY,
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

    let submissionData;
    try {
      submissionData = await fetchGoCanvasSubmission(submissionId);
      console.log("Full submission fetched:");
      console.log(JSON.stringify(submissionData, null, 2).slice(0, 4000));
    } catch (err) {
      console.error("Failed to fetch submission:");
      console.error(err.response?.data || err.message);
      return res.status(200).send("Fetch failed");
    }

    const email = findEmailInGoCanvasJson(submissionData);

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
