require("dotenv").config();
const express = require("express");
const session = require("cookie-session");
const { google } = require("googleapis");
const { Groq } = require("groq-sdk");

const app = express();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const oAuth2Client = new google.auth.OAuth2({
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
});

app.use(
  session({
    name: "session",
    keys: ["super-secret-key"],
  })
);

function getPlainText(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      const text = getPlainText(part);
      if (text) return text;
    }
  }

  return "";
}

app.get("/login", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oAuth2Client.getToken(code);
  req.session.tokens = tokens;
  res.send("Login successful! Go to /latest to fetch your latest email.");
});

app.get("/emails", async (req, res) => {
  if (!req.session.tokens) return res.redirect("/login");
  oAuth2Client.setCredentials(req.session.tokens);

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: "after:2025/3/18 before:2026/3/19",
  });

  // Make sure there are messages
  if (!list.data.messages) return [];

  const listData = await Promise.all(
    list.data.messages.map(async (data) => {
      const messageId = data.id;

      const message = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const body = getPlainText(message.data.payload);

      // Extract payload or any info you need
      const subjectHeader = message.data.payload.headers.find(
        (h) => h.name === "Subject"
      );
      const subject = subjectHeader ? subjectHeader.value : "(no subject)";

      return {
        id: messageId,
        subject,
        threadId: message.data.threadId,
        snippet: message.data.snippet,
        body,
      };
    })
  );




  const testEmail = await gmail.users.messages.get({
    userId: "me",
    id: listData[9].id,
    format: "full",
  });
   const body = getPlainText(testEmail.data.payload);

  const response = groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: "An email data will be passed to you and your job is to identify the intent of the email and tell in short what they are looking for summarize it and tell me about the intent of email and give me a draft as a response for the email as well"
      },
      {
        role: "user",
        content: body
      }
    ]
  }).then((chatCompletions) => {
    console.log(chatCompletions.choices[0]?.message?.content)
  })

  return res.json(listData);
});


app.get("/get-my-emails", async(req, res) => {
  try {  
    if (!req.session.tokens) return res.redirect("/login");
    oAuth2Client.setCredentials(req.session.tokens);

    const gmail = await google.gmail({ version: "v1", auth: oAuth2Client });

    const myEmails = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["SENT"],
      maxResults: 30
    });

    console.log(myEmails);

    const listMyEmails = await Promise.all(
        myEmails.data.messages.map(async (data) => {
          const messageId = data.id;

          const message = await gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full",
          });

          const body = getPlainText(message.data.payload);

          // Extract payload or any info you need
          const subjectHeader = message.data.payload.headers.find(
            (h) => h.name === "Subject"
          );
          const subject = subjectHeader ? subjectHeader.value : "(no subject)";

          return {
            id: messageId,
            subject,
            threadId: message.data.threadId,
            snippet: message.data.snippet,
            body,
          };
        })
      );

    const myEmailTyping = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: "These are the emails by user in the tone which user use to send emails to others. You have to adapt the user email typing and make a sample draft which aligns with it. also make sure the typing of the draft matches the way user type The format of the given data will be stringify json understand the user typing from the snippet body."
        }, 
        {
          role: "user",
          content: JSON.stringify(listMyEmails)
        }
      ]
    });

    console.log("AI: ", myEmailTyping.choices[0].message.content);

    return res.json({ data: listMyEmails });

  } catch (error) {
    return res.json(error);
  }
})

export async function createRawMessage(recipientEmail, subject, body) {
  const messageParts = [
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    `To: ${recipientEmail}`,
    `Subject: ${subject}`,
    "",
    `<html><body>${body}</body></html>`,
  ];

  const message = messageParts.join("\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

app.get("/create-draft", async (req, res) => {
  if (!req.session.tokens) return res.redirect("/login");
  oAuth2Client.setCredentials(req.session.tokens);

  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const draftInfo = await gmail.users.drafts.create({
      userId: "me",

      requestBody: {
        message: {
          raw: await createRawMessage(
            "hakamsandhu2006@gmail.com",
            "Test Email from Node",
            "The email sent to you from node js env and will be more sent to you for further testing"
          ),
          threadId: "1995c24edb51c466",
        },
      },
    });

    console.log(sendEmail);

    return res.status(200).json({ message: "Draft Created", draftInfo });
  } catch (error) {
    console.error("Draft creation failed:", error);
    return res
      .status(400)
      .json({ message: "Error creating draft for email", error });
  }
});

app.get("/compose-new-email", async (req, res) => {
  try {
    if (!req.session.tokens) return res.redirect("/login");
    oAuth2Client.setCredentials(req.session.tokens);

    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const draftInfo = await gmail.users.drafts.create({
      userId: "me",

      requestBody: {
        message: {
          raw: await createRawMessage(
            "hakamsandhu2006@gmail.com",
            "Test Email from Node",
            "The email sent to you from node js env and will be more sent to you for further testing"
          ),
        },
      },
    });

    const sendEmail = await gmail.users.drafts.send({
      userId: "me",
      requestBody: {
        id: draftInfo.data.id,
      },
    });

    return res.status(200).json({ message: sendEmail });
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Failed to send a fresh email", error });
  }
});

app.listen(3000, () => {
  console.log(`Server is running on PORT 3000`);
});
