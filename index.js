const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BREVO_CUSTOMER_LIST_ID = Number(process.env.BREVO_CUSTOMER_LIST_ID);

// ===== ROOT CHECK =====
app.get("/", (req, res) => {
  res.send("GoCanvas/Brevo webhook is running.");
});

// ===== HELPERS =====
function flattenSubmissionData(payload) {
  const out = {};

  if (Array.isArray(payload?.fields)) {
    for (const field of payload.fields) {
      if (field?.label) out[field.label] = field.value ?? "";
      if (field?.name && !(field.name in out)) out[field.name] = field.value ?? "";
    }
  }

  if (Array.isArray(payload?.values)) {
    for (const value of payload.values) {
      const key =
        value?.export_label ||
        value?.label ||
        value?.name ||
        value?.field_name;

      if (key) out[key] = value?.value ?? "";
    }
  }

  if (payload && typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      if (
        ![
          "fields",
          "values",
          "submission",
          "form",
          "dispatch_item",
          "type",
          "id",
          "guid",
        ].includes(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean")
      ) {
        out[key] = value;
      }
    }
  }

  return out;
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

// ===== FETCH FULL SUBMISSION =====
async function fetchGoCanvasSubmission(submissionId) {
  const apiKey = process.env.GOCANVAS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOCANVAS_API_KEY environment variable");
  }

  const url = `https://www.gocanvas.com/apiv2/submissions/${submissionId}.json`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    timeout: 30000,
  });

  return response.data;
}

// ===== SEND TO BREVO =====
async function upsertBrevoContact({ email, firstName, lastName, phone, company }) {
  await axios.post(
    "https://api.brevo.com/v3/contacts",
    {
      email,
      attributes: {
        FIRSTNAME: firstName,
        LASTNAME: lastName,
        PHONE: phone,
        COMPANY: company,
      },
      listIds: [BREVO_CUSTOMER_LIST_ID].filter(Boolean),
      updateEnabled: true,
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
}

// ===== WEBHOOK =====
app.post("/gocanvas-webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    const submissionId = req.body?.submission?.id;

    if (!submissionId) {
      console.log("No submission ID in payload.");
      return res.status(200).send("Received");
    }

    let fullData;

    try {
      fullData = await fetchGoCanvasSubmission(submissionId);
      console.log("Full submission fetched:");
      console.log(JSON.stringify(fullData, null, 2));
    } catch (err) {
      console.error("Failed to fetch submission:");
      console.error(err.response?.data || err.message);
      return res.status(200).send("Fetch failed");
    }

    const flat = flattenSubmissionData(fullData);

    const email = pickFirst(flat, [
      "Email",
      "Customer Email",
      "Email Address",
      "email",
    ]);

    const firstName = pickFirst(flat, [
      "First Name",
      "Customer First Name",
      "first_name",
      "firstname",
    ]);

    const lastName = pickFirst(flat, [
      "Last Name",
      "Customer Last Name",
      "last_name",
      "lastname",
    ]);

    const phone = pickFirst(flat, [
      "Phone",
      "Phone Number",
      "Customer Phone",
      "phone",
      "SMS",
      "sms",
    ]);

    const company = pickFirst(flat, [
      "Company",
      "Company Name",
      "Business Name",
      "company",
    ]);

    if (!email) {
      console.log("No email found in full submission data.");
      console.log("Flattened submission:");
      console.log(JSON.stringify(flat, null, 2));
      return res.status(200).send("Received, but no email found");
    }

    console.log("Brevo list ID:", BREVO_CUSTOMER_LIST_ID);

    await upsertBrevoContact({
      email,
      firstName,
      lastName,
      phone,
      company,
    });

    console.log("Contact sent to Brevo");

    res.status(200).send("Success");
  } catch (err) {
    console.error("Webhook handler error:");
    console.error(err.response?.data || err.message);
    res.status(500).send("Server error");
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
