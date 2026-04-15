const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");
const { Readable } = require("stream");

async function getAuthClient() {
  const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT);
  const auth = new GoogleAuth({ credentials, scopes:["https://www.googleapis.com/auth/drive"] });
  return auth.getClient();
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers, body:"" };
  if (event.httpMethod !== "POST") return { statusCode:405, headers, body: JSON.stringify({error:"Method not allowed"}) };
  try {
    const { folderId, subfolder, fileName, mimeType, fileBase64 } = JSON.parse(event.body);
    if (!folderId||!fileName||!fileBase64) throw new Error("folderId, fileName e fileBase64 obrigatórios");

    const authClient = await getAuthClient();
    const drive = google.drive({ version:"v3", auth:authClient });

    let targetId = folderId;
    if (subfolder) {
      const sub = await drive.files.list({
        q: `name='${subfolder}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id)",
      });
      if (sub.data.files.length > 0) targetId = sub.data.files[0].id;
    }

    const buffer = Buffer.from(fileBase64, "base64");
    const date = new Date().toISOString().split("T")[0];
    const uploaded = await drive.files.create({
      requestBody: { name:`${date}_${fileName}`, parents:[targetId] },
      media: { mimeType: mimeType||"application/octet-stream", body: Readable.from(buffer) },
      fields: "id,name,webViewLink",
    });
    await drive.permissions.create({
      fileId: uploaded.data.id,
      requestBody: { role:"reader", type:"anyone" },
    });
    return { statusCode:200, headers, body: JSON.stringify({ fileId:uploaded.data.id, fileName:uploaded.data.name, viewLink:uploaded.data.webViewLink }) };
  } catch(err) {
    console.error(err);
    return { statusCode:500, headers, body: JSON.stringify({error:err.message}) };
  }
};
