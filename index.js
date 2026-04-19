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

function normalizeLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function extractFieldsFromGoCanvasJson(node, fields = {}) {
  if (!node) return fields;

  if (Array.isArray(node)) {
    for (const item of node) {
      extractFieldsFromGoCanvasJson(item, fields);
    }
    return fields;
  }

  if (typeof node !== "object") {
    return fields;
  }

  const label = typeof node.Label === "string" ? node.Label.trim() : "";
  const value = typeof node.Value === "string" ? node.Value.trim() : "";
  const normalizedLabel = normalizeLabel(label);

  if (value) {
    if (normalizedLabel === "email" && !fields.email) {
      fields.email = value;
    }

    if (
      ["firstname", "customerfirstname", "first"].includes(normalizedLabel) &&
      !fields.firstName
    ) {
      fields.firstName = value;
    }

    if (
      ["lastname", "customerlastname", "last"].includes(normalizedLabel) &&
      !fields.lastName
    ) {
      fields.lastName = value;
    }
  }

  for (const key of Object.keys(node)) {
    extractFieldsFromGoCanvasJson(node[key], fields);
  }

  return fields;
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
    params: {
      username,
    },
    timeout: 30000,
  });

  return response.data;
}

async function upsertBrevoContact({ email, firstName, lastName }) {
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (!brevoApiKey) {
    throw new Error("Missing BREVO_API_KEY");
  }

  if (!BREVO_CUSTOMER_LIST_ID) {
    throw new Error("Missing BREVO_CUSTOMER_LIST_ID");
  }

  const attributes = {};

  if (firstName) attributes.FIRSTNAME = firstName;
  if (lastName) attributes.LASTNAME = lastName;

  await axios.post(
    "https://api.brevo.com/v3/contacts",
    {
      email,
      attributes,
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

    const fields = extractFieldsFromGoCanvasJson(submissionData);

    console.log("Extracted fields:", fields);

    if (!fields.email) {
      console.log('Field "Email" not found in submission data.');
      return res.status(200).send('Received, but field "Email" not found');
    }

    await upsertBrevoContact({
      email: fields.email,
      firstName: fields.firstName,
      lastName: fields.lastName,
    });

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
