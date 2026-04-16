const {google} = require("googleapis");

async function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GDRIVE_CLIENT_ID,
    process.env.GDRIVE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  oauth2Client.setCredentials({refresh_token: process.env.GDRIVE_REFRESH_TOKEN});
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
    if (!b.clientName) throw new Error("clientName obrigatorio");

    const ROOT = process.env.GDRIVE_ROOT_FOLDER_ID;
    const authClient = await getAuthClient();
    const drive = google.drive({version: "v3", auth: authClient});

    // Check if folder already exists
    const q = "name='" + b.clientName.replace(/'/g, "\\'") + "' and '" + ROOT + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
    const existing = await drive.files.list({q: q, fields: "files(id,name)"});
    if (existing.data.files.length > 0) {
      return {statusCode: 200, headers: h, body: JSON.stringify({folderId: existing.data.files[0].id, created: false})};
    }

    // Create client folder
    const folder = await drive.files.create({
      requestBody: {name: b.clientName, mimeType: "application/vnd.google-apps.folder", parents: [ROOT]},
      fields: "id"
    });
    const folderId = folder.data.id;

    // Create subfolders
    const subs = ["📋 Processo", "🪪 Documentos Pessoais", "💳 Comprovantes de Pagamento", "📄 Contratos"];
    for (var i = 0; i < subs.length; i++) {
      await drive.files.create({
        requestBody: {name: subs[i], mimeType: "application/vnd.google-apps.folder", parents: [folderId]}
      });
    }

    return {statusCode: 200, headers: h, body: JSON.stringify({folderId: folderId, created: true})};
  } catch(e) {
    console.error("create-folder error:", e.message);
    return {statusCode: 500, headers: h, body: JSON.stringify({error: e.message})};
  }
};
