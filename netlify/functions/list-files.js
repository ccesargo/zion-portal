const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");

async function getAuthClient() {
  const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT);
  const auth = new GoogleAuth({ credentials, scopes:["https://www.googleapis.com/auth/drive.readonly"] });
  return auth.getClient();
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers, body:"" };
  try {
    const folderId = event.queryStringParameters?.folderId;
    if (!folderId) throw new Error("folderId obrigatório");
    const authClient = await getAuthClient();
    const drive = google.drive({ version:"v3", auth:authClient });
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id,name,mimeType,size,createdTime,webViewLink)",
      orderBy: "createdTime desc",
    });
    return { statusCode:200, headers, body: JSON.stringify({ files:res.data.files }) };
  } catch(err) {
    return { statusCode:500, headers, body: JSON.stringify({error:err.message}) };
  }
};
