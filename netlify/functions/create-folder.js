const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  // Check env vars first
  if (!process.env.GDRIVE_SERVICE_ACCOUNT) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "GDRIVE_SERVICE_ACCOUNT não configurada no Netlify" }) };
  }
  if (!process.env.GDRIVE_ROOT_FOLDER_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "GDRIVE_ROOT_FOLDER_ID não configurada no Netlify" }) };
  }

  let credentials;
  try {
    credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT);
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "GDRIVE_SERVICE_ACCOUNT inválida — erro ao fazer parse do JSON: " + e.message }) };
  }

  const ROOT_FOLDER_ID = process.env.GDRIVE_ROOT_FOLDER_ID;

  try {
    const { clientName, clientId } = JSON.parse(event.body);
    if (!clientName) throw new Error("clientName obrigatório");

    const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive"] });
    const authClient = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: authClient });

    // Check if folder already exists
    const existing = await drive.files.list({
      q: `name='${clientName.replace(/'/g, "\\'")}' and '${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
    });

    if (existing.data.files.length > 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ folderId: existing.data.files[0].id, created: false }) };
    }

    // Create client folder
    const folder = await drive.files.create({
      requestBody: { name: clientName, mimeType: "application/vnd.google-apps.folder", parents: [ROOT_FOLDER_ID] },
      fields: "id",
    });
    const folderId = folder.data.id;

    // Create subfolders
    for (const name of ["📋 Processo", "🪪 Documentos Pessoais", "💳 Comprovantes de Pagamento", "📄 Contratos"]) {
      await drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [folderId] },
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ folderId, created: true }) };
  } catch(err) {
    console.error("create-folder error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, stack: err.stack?.split('\n')[0] }) };
  }
};
