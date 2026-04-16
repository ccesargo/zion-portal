const {google} = require("googleapis");
const {Readable} = require("stream");

async function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GDRIVE_CLIENT_ID,
    process.env.GDRIVE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GDRIVE_REFRESH_TOKEN
  });
  return oauth2Client;
}

exports.handler = async function(event) {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return {statusCode: 200, headers: h, body: ""};
  if (event.httpMethod !== "POST") return {statusCode: 405, headers: h, body: JSON.stringify({error: "Method not allowed"})};

  try {
    const b = JSON.parse(event.body);
    if (!b.folderId || !b.fileName || !b.fileBase64) throw new Error("Missing required fields");

    const authClient = await getAuthClient();
    const drive = google.drive({version: "v3", auth: authClient});

    let targetId = b.folderId;
    if (b.subfolder) {
      const q = "name='" + b.subfolder + "' and '" + b.folderId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
      const sr = await drive.files.list({q: q, fields: "files(id)"});
      if (sr.data.files.length > 0) targetId = sr.data.files[0].id;
    }

    const buf = Buffer.from(b.fileBase64, "base64");
    const dt = new Date().toISOString().split("T")[0];

    const up = await drive.files.create({
      requestBody: {name: dt + "_" + b.fileName, parents: [targetId]},
      media: {mimeType: b.mimeType || "application/octet-stream", body: Readable.from(buf)},
      fields: "id,name,webViewLink"
    });

    await drive.permissions.create({
      fileId: up.data.id,
      requestBody: {role: "reader", type: "anyone"}
    });

    return {
      statusCode: 200,
      headers: h,
      body: JSON.stringify({fileId: up.data.id, fileName: up.data.name, viewLink: up.data.webViewLink})
    };
  } catch(e) {
    console.error("upload error:", e.message);
    return {statusCode: 500, headers: h, body: JSON.stringify({error: e.message})};
  }
};
