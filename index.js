const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BREVO_CUSTOMER_LIST_ID = Number(process.env.BREVO_CUSTOMER_LIST_ID || 46);
const BREVO_NEW_LEAD_LIST_ID = Number(process.env.BREVO_NEW_LEAD_LIST_ID || 23);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function requireEnv(name, value) {
  if (!value || String(value).trim() === "") {
    throw new Error(`Missing ${name}`);
  }
}

async function fetchGoCanvasSubmission(submissionId) {
  const apiKey = process.env.GOCANVAS_API_KEY;
  const username = process.env.GOCANVAS_USERNAME;

  requireEnv("GOCANVAS_API_KEY", apiKey);
  requireEnv("GOCANVAS_USERNAME", username);

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

async function updateBrevoContactLists(email) {
  const brevoApiKey = process.env.BREVO_API_KEY;

  requireEnv("BREVO_API_KEY", brevoApiKey);

  if (!BREVO_CUSTOMER_LIST_ID) {
    throw new Error("Missing BREVO_CUSTOMER_LIST_ID");
  }

  if (!BREVO_NEW_LEAD_LIST_ID) {
    throw new Error("Missing BREVO_NEW_LEAD_LIST_ID");
  }

  await axios.put(
    `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
    {
      listIds: [BREVO_CUSTOMER_LIST_ID],
      unlinkListIds: [BREVO_NEW_LEAD_LIST_ID],
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
    if (!WEBHOOK_SECRET) {
      console.error("Webhook blocked: WEBHOOK_SECRET is not configured.");
      return res.status(500).send("Webhook secret not configured");
    }

    if (req.query.secret !== WEBHOOK_SECRET) {
      console.warn("Webhook rejected: invalid secret.");
      return res.status(403).send("Forbidden");
    }

    console.log("Webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    const submissionId = req.body?.submission?.id;

    if (!submissionId) {
      console.warn("Bad submission: missing submission.id");
      return res.status(400).send("Missing submission ID");
    }

    let submissionXml;

    try {
      submissionXml = await fetchGoCanvasSubmission(submissionId);
      console.log(`Submission ${submissionId} fetched successfully.`);
      console.log(submissionXml.slice(0, 4000));
    } catch (err) {
      console.error(`Fetch failed for submission ${submissionId}:`);
      console.error(err.response?.data || err.message);
      return res.status(502).send("Fetch failed");
    }

    const email = extractEmailFromXml(submissionXml);

    if (!email) {
      console.warn(`Submission ${submissionId}: Email field not found.`);
      return res.status(200).send('Received, but field "Email" not found');
    }

    if (!isValidEmail(email)) {
      console.warn(`Submission ${submissionId}: invalid email extracted -> ${email}`);
      return res.status(200).send("Received, but email was invalid");
    }

    console.log(`Submission ${submissionId}: email found -> ${email}`);

    try {
      await updateBrevoContactLists(email);
      console.log(
        `Brevo updated: ${email} added to list ${BREVO_CUSTOMER_LIST_ID} and removed from list ${BREVO_NEW_LEAD_LIST_ID}.`
      );
    } catch (err) {
      console.error(`Brevo update failed for ${email}:`);
      console.error(err.response?.data || err.message);
      return res.status(502).send("Brevo update failed");
    }

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
