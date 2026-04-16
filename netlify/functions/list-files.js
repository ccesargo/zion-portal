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

  try {
    const folderId = event.queryStringParameters && event.queryStringParameters.folderId;
    if (!folderId) throw new Error("folderId obrigatorio");

    const authClient = await getAuthClient();
    const drive = google.drive({version: "v3", auth: authClient});

    const res = await drive.files.list({
      q: "'" + folderId + "' in parents and trashed=false",
      fields: "files(id,name,mimeType,size,createdTime,webViewLink)",
      orderBy: "createdTime desc"
    });

    return {statusCode: 200, headers: h, body: JSON.stringify({files: res.data.files})};
  } catch(e) {
    console.error("list-files error:", e.message);
    return {statusCode: 500, headers: h, body: JSON.stringify({error: e.message})};
  }
};
