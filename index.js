const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
app.use(express.json());

const BREVO_CUSTOMER_LIST_ID = Number(process.env.BREVO_CUSTOMER_LIST_ID);

app.get("/", (req, res) => {
  res.send("GoCanvas/Brevo webhook is running.");
});

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (
      obj[key] !== undefined &&
      obj[key] !== null &&
      String(obj[key]).trim() !== ""
    ) {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenGoCanvasXml(parsed) {
  const out = {};

  try {
    const root = parsed?.CanvasResult?.Submissions?.Submission;
    if (!root) return out;

    const screens = ensureArray(root.Screens?.Screen);

    for (const screen of screens) {
      const sections = ensureArray(screen.Sections?.Section);

      for (const section of sections) {
        const responses = ensureArray(section.Responses?.Response);

        for (const response of responses) {
          const label = String(response?.Label ?? "").trim();
          const value = String(response?.Value ?? "").trim();

          if (label) {
            out[label] = value;
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed flattening GoCanvas XML:", err.message);
  }

  return out;
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

async function parseGoCanvasXml(xmlString) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  return parser.parseStringPromise(xmlString);
}

async function upsertBrevoContact({
  email,
  firstName,
  lastName,
  phone,
  company,
}) {
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

app.post("/gocanvas-webhook", async (req, res) => {
  try {
    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    const submissionId = req.body?.submission?.id;

    if (!submissionId) {
      console.log("No submission ID in payload.");
      return res.status(200).send("Received");
    }

    let rawData;

    try {
      rawData = await fetchGoCanvasSubmission(submissionId);
      console.log("Full submission fetched:");
      console.log(typeof rawData === "string" ? rawData.slice(0, 2000) : JSON.stringify(rawData, null, 2));
    } catch (err) {
      console.error("Failed to fetch submission:");
      console.error(err.response?.data || err.message);
      return res.status(200).send("Fetch failed");
    }

    let parsed;
    try {
      parsed = await parseGoCanvasXml(rawData);
    } catch (err) {
      console.error("Failed to parse XML:");
      console.error(err.message);
      return res.status(200).send("XML parse failed");
    }

    const flat = flattenGoCanvasXml(parsed);

    console.log("Flattened submission:");
    console.log(JSON.stringify(flat, null, 2));

    const email = pickFirst(flat, [
      "Email",
      "Customer Email",
      "Email Address",
      "preferred email for communication and completed document delivery",
      "Email address",
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
      "Provide best contact number (mobile preferred).",
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
      return res.status(200).send("Received, but no email found");
    }

    console.log("Sending to Brevo:", email);

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
});
