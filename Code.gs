/**
 * Masterscan Engineering Pte Ltd - NDT Reporting Backend
 * Author: Antigravity AI
 */

/** @NotOnlyCurrentDoc */

const ROOT_FOLDER_NAME = "Masterscan Reporting";

function doGet(e) {
  const action = e.parameter.action;
  if (action === "getClients") return jsonResponse({ clients: getClientFolders(e.parameter.dept) });
  if (action === "getReport") return jsonResponse(fetchReportFromDoc(e.parameter.docId));
  if (action === "findReport") return jsonResponse(findReportByInfo(e.parameter.dept, e.parameter.client, e.parameter.date, e.parameter.reportNo));
  if (action === "reindex") return jsonResponse(reindexExistingReports());
  
  return HtmlService.createHtmlOutput(`
    <div style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f4f7f9; height: 100vh;">
      <div style="background: white; display: inline-block; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <h1 style="color: #003366; margin-bottom: 10px;">Masterscan Reporting API</h1>
        <p style="color: #666; font-size: 1.2rem;">Status: <span style="color: #4CAF50; font-weight: bold;">SERVICE READY</span></p>
        <hr style="width: 100%; border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 0.9rem; color: #999;">Backend is active. Please use the app interface.</p>
      </div>
    </div>
  `).setTitle("Masterscan API Status").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let data;
  try {
    if (e.postData && e.postData.contents) {
      // Try parsing as raw JSON
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter || {};
    }
  } catch (err) {
    // If JSON parsing fails (common with form-encoded data), use parameters
    data = e.parameter || {};
  }
  
  // Check if data is wrapped in a 'payload' parameter (Safari fix)
  if (data && data.payload) {
    try {
      data = JSON.parse(data.payload);
    } catch (err) {
      // If parsing fails, keep data as is
    }
  }
  
  const action = data.action;
  
  const isIframe = data.useIframe === true || data.useIframe === "true";
  
  try {
    let result;
    if (action === "createFolders") result = createFolderHierarchy(data.dept, data.client, data.date, data.reportNo);
    else if (action === "saveReport") result = generateReportDoc(data.folderId, data.reportData, data.tableData, data.signatureImages, data.dept, data.images, data.previewHtml);
    else if (action === "saveSheet") result = generateDataTableSheet(data.folderId, data.tableData, data.dept, data.reportData, data.signatures, data.images);
    else if (action === "uploadImage") result = saveImageToDrive(data.folderId, data.imageBase64, data.fileName);
    else if (action === "masterSave") result = masterSave(data);
    else if (action === "findReport") result = findReportByInfo(data.dept, data.client, data.date, data.reportNo);
    else if (action === "getReport") result = fetchReportFromDoc(data.docId);
    else if (action === "getClients") result = { clients: getClientFolders(data.dept) };
    else if (action === "login") result = loginUser(data.username, data.password);
    else if (action === "getReports") result = getReportsList(data.role, data.clientName);
    else if (action === "updateReportStatus") result = updateReportStatus(data.folderId, data.statusField, data.statusValue);
    else if (action === "sendReportEmail") result = sendReportEmail(data.folderId, data.email);
    else if (action === "reindex") result = reindexExistingReports();
    else if (action === "getUsersList") result = getUsersList();
    else if (action === "createClientUser") result = createClientUser(data.clientName, data.email);
    else return jsonResponse({ status: "error", message: "Invalid POST action" }, isIframe);

    return jsonResponse(result, isIframe);
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() }, isIframe);
  }
}

function jsonResponse(data, isIframe = false) {
  const json = JSON.stringify(data);
  if (isIframe) {
    // This is the key: returning an HTML page that posts the result back to the parent window
    // This bypasses CORS and ITP because it's a standard window message
    return HtmlService.createHtmlOutput(`
      <script>
        (function() {
          const result = ${json};
          window.parent.postMessage({ type: 'GAS_RESPONSE', data: result }, '*');
        })();
      </script>
    `).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getRootFolder() {
  const folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getDeptFolder(dept) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Increased to 30s
    const root = getRootFolder();
    const folders = root.getFoldersByName(dept.trim());
    if (folders.hasNext()) return folders.next();
    return root.createFolder(dept.trim());
  } finally {
    lock.releaseLock();
  }
}

function getClientFolders(dept) {
  const deptFolder = getDeptFolder(dept);
  const folders = deptFolder.getFolders();
  const clients = [];
  while (folders.hasNext()) {
    clients.push(folders.next().getName());
  }
  return clients;
}

function createFolderHierarchy(dept, client, date, reportNo) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000); // Increased to 60s
    
    const deptFolder = getDeptFolder(dept);
    let clientFolder;
    const clientName = (client || "UNKNOWN").toUpperCase().trim();
    const clientFolders = deptFolder.getFoldersByName(clientName);
    
    if (clientFolders.hasNext()) {
      clientFolder = clientFolders.next();
    } else {
      clientFolder = deptFolder.createFolder(clientName);
    }
    
    // Standardize date folder name to DD.MM.YYYY
    let dateFolderName = date || "NO_DATE";
    try {
      // Handle various formats: YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY
      let cleanDate = dateFolderName.toString().replace(/\./g, '-').replace(/\//g, '-');
      let parts = cleanDate.split('-');
      let d;
      if (parts.length === 3) {
        if (parts[0].length === 4) d = new Date(cleanDate); // YYYY-MM-DD
        else d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`); // DD-MM-YYYY -> YYYY-MM-DD
      } else {
        d = new Date(dateFolderName);
      }

      if (!isNaN(d.getTime())) {
        dateFolderName = Utilities.formatDate(d, Session.getScriptTimeZone(), "dd.MM.yyyy");
      }
    } catch(e) {}
    
    let dateFolder;
    const dateFolders = clientFolder.getFoldersByName(dateFolderName);
    if (dateFolders.hasNext()) dateFolder = dateFolders.next();
    else dateFolder = clientFolder.createFolder(dateFolderName);
    
    // Handle Report X folders
    let reportFolder;
    if (reportNo) {
      const reportName = reportNo.toString().toLowerCase().startsWith("report") ? reportNo : "report " + reportNo;
      const existing = dateFolder.getFoldersByName(reportName);
      if (existing.hasNext()) reportFolder = existing.next();
      else reportFolder = dateFolder.createFolder(reportName);
    } else {
      // Generate new report number
      let count = 0;
      const folders = dateFolder.getFolders();
      while (folders.hasNext()) {
        const f = folders.next();
        if (f.getName().toLowerCase().startsWith("report ")) count++;
      }
      reportFolder = dateFolder.createFolder("report " + (count + 1));
    }
    
    let imagesFolder;
    const imgFolders = reportFolder.getFoldersByName("Images");
    if (imgFolders.hasNext()) imagesFolder = imgFolders.next();
    else imagesFolder = reportFolder.createFolder("Images");

    let sigFolder;
    const sigFolders = reportFolder.getFoldersByName("Signatures");
    if (sigFolders.hasNext()) sigFolder = sigFolders.next();
    else sigFolder = reportFolder.createFolder("Signatures");
    
    return { 
      folderId: reportFolder.getId(), 
      folderUrl: reportFolder.getUrl(), 
      imagesFolderId: imagesFolder.getId(),
      signaturesFolderId: sigFolder.getId(),
      reportName: reportFolder.getName()
    };
  } finally {
    lock.releaseLock();
  }
}

function generateReportDoc(folderId, reportData, tableData, signatureImages, dept, images, previewHtml) {
  if (!folderId || folderId === "mock-folder-id") {
     throw new Error("Invalid Folder ID. Please check your connection and try again.");
  }
  const folder = DriveApp.getFolderById(folderId);
  
  let formattedDate = "";
  const dateVal = reportData.DATE || reportData.date;
  if (dateVal) {
    const d = new Date(dateVal);
    formattedDate = Utilities.formatDate(d, Session.getScriptTimeZone(), "dd.MM.yyyy");
  }
  
  const clientName = (reportData.CLIENT || reportData.client || "UNKNOWN").toUpperCase();
  const docName = clientName + "_" + (formattedDate || new Date().getTime());
  
  // Get logo (with caching)
  let logoBase64 = "";
  const cache = CacheService.getScriptCache();
  const cachedLogo = cache.get("header_logo_b64");
  if (cachedLogo) {
    logoBase64 = cachedLogo;
  } else {
    try {
      const logoFile = DriveApp.getFileById("1Pi2zaw01dJcZxElDJNf4XW6_edl65Txy");
      logoBase64 = Utilities.base64Encode(logoFile.getBlob().getBytes());
      cache.put("header_logo_b64", logoBase64, 21600); // 6 hours
    } catch(e) {}
  }

  // Embed full state
  const fullState = { reportData, tableData, signatureImages, dept, images, timestamp: new Date().toISOString() };
  const jsonBlob = Utilities.base64Encode(JSON.stringify(fullState));

  // Extract styles from previewHtml if any
  let styles = "";
  if (previewHtml) {
    const styleMatch = previewHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (styleMatch) {
      styles = styleMatch[1];
      previewHtml = previewHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/i, "");
    }
  }

  let fullHtml = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${docName}</title>
      <style>${styles}</style>
    </head>
    <body style="font-family: 'Source Sans 3', sans-serif;">
  `;

  if (previewHtml) {
    if (logoBase64) {
      previewHtml = previewHtml.replace(/src="header\s*logo\.png"/g, `src="data:image/png;base64,${logoBase64}"`);
    }
    
    // Replace Drive URLs with Base64 so they render in PDF/Doc
    const driveUrlRegex = /src="(https:\/\/drive\.google\.com\/[^"]+)"/g;
    let match;
    const driveImages = {};
    while ((match = driveUrlRegex.exec(previewHtml)) !== null) {
      const url = match[1];
      if (!driveImages[url]) {
        try {
          const fileId = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (fileId) {
            const blob = DriveApp.getFileById(fileId[1]).getBlob();
            const b64 = Utilities.base64Encode(blob.getBytes());
            driveImages[url] = `data:${blob.getContentType()};base64,${b64}`;
          }
        } catch (e) {
          console.error("Image Fetch Error: " + e.toString());
        }
      }
    }
    
    for (const url in driveImages) {
      previewHtml = previewHtml.split(url).join(driveImages[url]);
    }
    
    fullHtml += previewHtml;
  }
  fullHtml += `<div id="report-state-data" style="display:none; color:white; font-size:1pt;">${jsonBlob}</div>`;
  fullHtml += `</body></html>`;

  
  const blob = Utilities.newBlob(fullHtml, MimeType.HTML, docName + ".html");
  
  // 1. Handle PDF (Ensures only ONE exists and keeps same ID if possible)
  const pdfBlob = blob.getAs(MimeType.PDF);
  const existingPdfs = folder.getFilesByType(MimeType.PDF);
  let pdfFile;
  
  while (existingPdfs.hasNext()) {
    existingPdfs.next().setTrashed(true);
  }

  // Create new PDF
  pdfFile = folder.createFile(pdfBlob);
  pdfFile.setName(docName + ".pdf");


  // 2. Handle Google Doc (Ensures only ONE exists and keeps same ID if possible)
  let docId = "";
  let googleDocUrl = "";
  try {
    const existingDocs = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    let existingDoc = null;
    if (existingDocs.hasNext()) {
      existingDoc = existingDocs.next();
      // Update existing Doc content
      const updatedDoc = updateGoogleDocFromHtml(existingDoc.getId(), blob, docName);
      if (updatedDoc) {
        docId = updatedDoc.getId();
        googleDocUrl = updatedDoc.getUrl();
      }
      // Trash others
      while (existingDocs.hasNext()) existingDocs.next().setTrashed(true);
    } else {
      // Create new
      const docFile = convertHtmlToGoogleDoc(folderId, blob, docName);
      if (docFile) {
        docId = docFile.getId();
        googleDocUrl = docFile.getUrl();
      }
    }
  } catch (e) {
    console.error("Doc Error: " + e.toString());
    // If Doc fails, we still have the PDF
  }

  return { 
    docId: docId || pdfFile.getId(), 
    docUrl: googleDocUrl || pdfFile.getUrl(), 
    pdfUrl: pdfFile.getUrl(),
    googleDocUrl: googleDocUrl
  };
}

/**
 * Updates an existing file's content using Drive API v2
 */
function updateFileContent(fileId, blob) {
  try {
    const url = "https://www.googleapis.com/upload/drive/v2/files/" + fileId + "?uploadType=media";
    const options = {
      method: "put",
      contentType: blob.getContentType(),
      payload: blob.getBytes(),
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 400) {
      console.warn("updateFileContent failed with status " + response.getResponseCode());
    }
  } catch (e) {
    console.error("updateFileContent Error (Permissions?): " + e.toString());
    // Fallback: If we can't update content via REST API, we just let the caller handle it or accept the old version
  }
}

/**
 * Converts an HTML blob to a native Google Doc using Drive API
 */
function convertHtmlToGoogleDoc(folderId, blob, fileName) {
  const resource = {
    title: fileName,
    mimeType: MimeType.GOOGLE_DOCS,
    parents: [{ id: folderId }]
  };
  
  // Use UrlFetchApp to call Drive API v2 for conversion (avoids needing Advanced Service toggle)
  const url = "https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&convert=true";
  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelimiter = "\r\n--" + boundary + "--";
  
  const metadata = JSON.stringify(resource);
  const payload = delimiter + 
                  "Content-Type: application/json\r\n\r\n" + 
                  metadata + 
                  delimiter + 
                  "Content-Type: " + MimeType.HTML + "\r\n\r\n" + 
                  blob.getDataAsString() + 
                  closeDelimiter;
                  
  const options = {
    method: "post",
    contentType: "multipart/related; boundary=" + boundary,
    payload: payload,
    headers: {
      "Authorization": "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.id) {
      return DriveApp.getFileById(result.id);
    }
  } catch (e) {
    console.error("convertHtmlToGoogleDoc Fetch Error: " + e.toString());
  }
  return null;
}

/**
 * Updates an existing Google Doc with new HTML content
 */
function updateGoogleDocFromHtml(fileId, blob, fileName) {
  const resource = {
    title: fileName,
    mimeType: MimeType.GOOGLE_DOCS
  };
  
  const url = "https://www.googleapis.com/upload/drive/v2/files/" + fileId + "?uploadType=multipart&convert=true";
  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelimiter = "\r\n--" + boundary + "--";
  
  const metadata = JSON.stringify(resource);
  const payload = delimiter + 
                  "Content-Type: application/json\r\n\r\n" + 
                  metadata + 
                  delimiter + 
                  "Content-Type: " + MimeType.HTML + "\r\n\r\n" + 
                  blob.getDataAsString() + 
                  closeDelimiter;
                  
  const options = {
    method: "put",
    contentType: "multipart/related; boundary=" + boundary,
    payload: payload,
    headers: {
      "Authorization": "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return DriveApp.getFileById(fileId);
    }
  } catch (e) {
    console.error("updateGoogleDocFromHtml Fetch Error: " + e.toString());
  }
  return null;
}

function triggerAuth() {
  // Call this function manually once in the script editor to trigger authorization dialog
  UrlFetchApp.fetch("https://www.google.com");
  DriveApp.getRootFolder();
}

function generateDataTableSheet(folderId, tableData, dept, reportData, signatures, images) {
  const folder = DriveApp.getFolderById(folderId);
  const fileName = "Report_Data_Table";
  let ss;
  
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    ss = SpreadsheetApp.openById(existing.next().getId());
  } else {
    ss = SpreadsheetApp.create(fileName);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
  }
  
  // 1. Save Table Data
  let tableSheet = ss.getSheetByName("TableData");
  if (!tableSheet) {
    tableSheet = ss.getSheets()[0];
    tableSheet.setName("TableData");
  }
  tableSheet.clear();
  
  if (tableData && tableData.length > 0) {
    const headers = Object.keys(tableData[0]);
    const values = [headers];
    tableData.forEach(row => {
      values.push(headers.map(h => row[h] || ""));
    });
    tableSheet.getRange(1, 1, values.length, headers.length).setValues(values);
  }

  // 2. Save Form Data
  if (reportData) {
    let formSheet = ss.getSheetByName("FormData");
    if (!formSheet) formSheet = ss.insertSheet("FormData");
    formSheet.clear();
    const formValues = Object.entries(reportData);
    if (formValues.length > 0) {
      formSheet.getRange(1, 1, formValues.length, 2).setValues(formValues);
    }
  }

  // 3. Save Signatures
  if (signatures) {
    let sigSheet = ss.getSheetByName("Signatures");
    if (!sigSheet) sigSheet = ss.insertSheet("Signatures");
    sigSheet.clear();
    const sigHeaders = ["sigId", "name", "level", "date", "image"];
    const sigValues = [sigHeaders];
    Object.keys(signatures).forEach(sigId => {
      const s = signatures[sigId];
      let d = s.date || "";
      if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
      sigValues.push([sigId, s.name || "", s.level || "", d, s.image || ""]);
    });
    sigSheet.getRange(1, 1, sigValues.length, sigHeaders.length).setValues(sigValues);
  }

  // 4. Save Image Metadata
  if (images) {
    let imgSheet = ss.getSheetByName("Images");
    if (!imgSheet) imgSheet = ss.insertSheet("Images");
    imgSheet.clear();
    const imgHeaders = ["index", "caption", "fileName", "src"];
    const imgValues = [imgHeaders];
    images.forEach((img, idx) => {
      if (img && (img.src || img.caption)) {
        imgValues.push([idx, img.caption || "", img.fileName || "", img.src || ""]);
      }
    });
    if (imgValues.length > 1) {
      imgSheet.getRange(1, 1, imgValues.length, imgHeaders.length).setValues(imgValues);
    }
  }
  
  return { status: "success", sheetId: ss.getId(), sheetUrl: ss.getUrl() };
}

function saveImageToDrive(folderId, base64Data, fileName) {
  const folder = DriveApp.getFolderById(folderId);
  const folderName = folder.getName();
  
  // Decide which folder to use
  let targetFolder = folder;
  
  // If the folder passed is NOT already an Images/Signatures folder, find/create them
  if (folderName !== "Images" && folderName !== "Signatures") {
    const subfolderName = fileName.startsWith('sig_') ? "Signatures" : "Images";
    const subfolders = folder.getFoldersByName(subfolderName);
    if (subfolders.hasNext()) targetFolder = subfolders.next();
    else targetFolder = folder.createFolder(subfolderName);
  }
  
  const contentType = base64Data.substring(5, base64Data.indexOf(';'));
  const bytes = Utilities.base64Decode(base64Data.split(',')[1]);
  const blob = Utilities.newBlob(bytes, contentType, fileName);
  
  // Update in place if exists (Optimized)
  const existing = targetFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    while (existing.hasNext()) {
      try {
        existing.next().setTrashed(true);
      } catch(e) {}
    }
  }
  
  const file = targetFolder.createFile(blob);
  console.log(`Saved image: ${fileName} to ${targetFolder.getName()}`);

  
  return { fileId: file.getId(), fileUrl: file.getUrl() };
}

function fetchReportFromDoc(docId) {
  try {
    const docFile = DriveApp.getFileById(docId);
    const folder = docFile.getParents().next();
    
    let reportData = {};
    let tableData = [];
    let signatures = {};
    let images = [];
    let dept = "PT";

    // 1. Try to load from Google Sheet (Primary)
    const dataFiles = folder.getFilesByName("Report_Data_Table");
    if (dataFiles.hasNext()) {
      try {
        const ss = SpreadsheetApp.openById(dataFiles.next().getId());
        const tableSheet = ss.getSheetByName("TableData");
        if (tableSheet) {
          const values = tableSheet.getDataRange().getValues();
          if (values.length > 1) {
            const headers = values[0];
            tableData = values.slice(1).map(row => {
              const obj = {};
              headers.forEach((h, i) => obj[h] = row[i]);
              return obj;
            });
          }
        }
        const formSheet = ss.getSheetByName("FormData");
        if (formSheet) {
          formSheet.getDataRange().getValues().forEach(row => { if (row[0]) reportData[row[0]] = row[1]; });
        }
        const sigSheet = ss.getSheetByName("Signatures");
        if (sigSheet) {
          sigSheet.getDataRange().getValues().slice(1).forEach(row => {
            let d = row[3];
            if (d instanceof Date) d = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
            signatures[row[0]] = { name: row[1], level: row[2], date: d, image: row[4] };
          });
        }
        const imgSheet = ss.getSheetByName("Images");
        if (imgSheet) {
          imgSheet.getDataRange().getValues().slice(1).forEach(row => {
            images[parseInt(row[0])] = { caption: row[1], fileName: row[2], src: row[3] };
          });
        }
        
        // Final mapping of signatures from reportData if they weren't in sigSheet
        const sigRoles = ["Tested_By", "Reviewed_By", "Reviewed_Witness_By_1", "Reviewed_Witness_By_2"];
        sigRoles.forEach((role, idx) => {
          const sigId = `sig_${idx}`;
          if (!signatures[sigId]) signatures[sigId] = { name: "", level: "", date: "", image: "" };
          
          // Fill missing info from reportData (FormData sheet)
          if (!signatures[sigId].name) signatures[sigId].name = reportData[role + '_NAME'] || "";
          if (!signatures[sigId].level) signatures[sigId].level = reportData[role + '_LEVEL'] || "";
        });
      } catch(e) { console.error("Sheet Load Error: " + e.toString()); }
    }

    // 2. Second Tier: Try to recover directly from folders
    try {
      const imgFolders = folder.getFoldersByName("Images");
      if (imgFolders.hasNext()) {
        const files = imgFolders.next().getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const name = file.getName();
          
          // Only match files like photo_0.jpg, image_1.png, or files with a clear index
          // This prevents picking up unrelated files as duplicates
          const match = name.match(/(?:photo_|image_|^)(\d+)/i);
          if (match) {
            const idx = parseInt(match[1]);
            // Limit index to reasonable range (0-20) to avoid sparse array explosion
            if (idx >= 0 && idx < 50) {
              if (!images[idx]) images[idx] = { caption: "", fileName: name, src: file.getUrl() };
              else if (!images[idx].src) images[idx].src = file.getUrl();
            }
          }
        }
      }
      
      // Explicitly check Signatures folder
      const sigFolders = folder.getFoldersByName("Signatures");
      if (sigFolders.hasNext()) {
        const sigFolder = sigFolders.next();
        const files = sigFolder.getFiles();
        const sigRoles = ["Tested_By", "Reviewed_By", "Reviewed_Witness_By_1", "Reviewed_Witness_By_2"];
        
        while (files.hasNext()) {
          const file = files.next();
          const name = file.getName();
          let sigId = null;
          
          const numMatch = name.match(/sig_(\d+)/);
          if (numMatch) sigId = "sig_" + numMatch[1];
          else {
            const roleIdx = sigRoles.findIndex(r => name.toLowerCase().includes(r.toLowerCase()));
            if (roleIdx !== -1) sigId = "sig_" + roleIdx;
          }

          if (sigId) {
            if (!signatures[sigId]) {
              signatures[sigId] = { 
                name: "", 
                level: "", 
                date: Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd"), 
                image: file.getUrl() 
              };
            } else {
              if (!signatures[sigId].image) signatures[sigId].image = file.getUrl();
              // If date is missing in database but file exists, use file date as fallback
              if (!signatures[sigId].date) {
                signatures[sigId].date = Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd");
              }
            }
          }
        }
      }
    } catch (e) { console.error("Recovery Error: " + e.toString()); }

    // 3. Third Tier Fallback: Try to load from Doc Hidden State
    if (Object.keys(reportData).length === 0) {
      try {
        const doc = DocumentApp.openById(docId);
        const text = doc.getBody().getText();
        const lines = text.split("\n");
        const lastLine = lines[lines.length - 1];
        if (lastLine && lastLine.length > 100) {
          const decoded = JSON.parse(Utilities.newBlob(Utilities.base64Decode(lastLine)).getDataAsString());
          reportData = decoded.reportData || {};
          tableData = decoded.tableData || [];
          images = decoded.images || [];
          dept = decoded.dept || "PT";
          if (decoded.signatureImages) {
            Object.keys(decoded.signatureImages).forEach((role, idx) => {
              const sigId = `sig_${idx}`;
              if (!signatures[sigId] || !signatures[sigId].image) {
                if (!signatures[sigId]) signatures[sigId] = { name: "", level: "", date: "", image: decoded.signatureImages[role] };
                else signatures[sigId].image = decoded.signatureImages[role];
              }
            });
          }
        }
      } catch(e) {}
    }

    // Helper to ensure all image/signature links are Base64 for reliable display
    const ensureBase64 = (obj) => {
      try {
        let url = obj.src || obj.image;
        if (url && url.includes('drive.google.com')) {
          const idMatch = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (idMatch) {
            const blob = DriveApp.getFileById(idMatch[1]).getBlob();
            const b64 = "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
            if (obj.src) obj.src = b64;
            if (obj.image) obj.image = b64;
          }
        }
      } catch(e) { console.error("B64 Error: " + e.toString()); }
    };

    // Deduplicate images by source to prevent doubles
    const seenSrcs = new Set();
    const cleanImages = [];
    images.forEach((img, idx) => {
      if (img && img.src && !seenSrcs.has(img.src)) {
        seenSrcs.add(img.src);
        cleanImages[idx] = img;
      }
    });

    cleanImages.forEach(ensureBase64);
    Object.values(signatures).forEach(ensureBase64);

    if (reportData.DEPT) dept = reportData.DEPT;
    return { status: "success", reportData, tableData, signatures, images: cleanImages, dept, folderId: folder.getId() };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

function findReportByInfo(dept, client, date, reportNo) {
  try {
    const deptFolder = getDeptFolder(dept);
    let clientFolder;
    
    // Normalize dates for comparison (converts everything to YYYYMMDD)
    const normalizeDate = (d) => {
      if (!d) return "";
      const clean = d.replace(/[^0-9]/g, '');
      if (clean.length !== 8) return clean;
      
      // Check if it starts with year (YYYYMMDD) or ends with year (DDMMYYYY)
      if (parseInt(clean.substring(0, 4)) > 1900) {
        return clean; // Already YYYYMMDD
      } else {
        // Assume DDMMYYYY -> YYYYMMDD
        return clean.substring(4, 8) + clean.substring(2, 4) + clean.substring(0, 2);
      }
    };
    
    const searchDateClean = normalizeDate(date);
    
    const clientFolders = deptFolder.getFolders();
    while (clientFolders.hasNext()) {
      const f = clientFolders.next();
      if (f.getName().toLowerCase() === client.toLowerCase()) {
        clientFolder = f;
        break;
      }
    }
    if (!clientFolder) throw new Error("Client folder not found: " + client);
    
    let dateFolder;
    const dateFolders = clientFolder.getFolders();
    while (dateFolders.hasNext()) {
      const f = dateFolders.next();
      if (normalizeDate(f.getName()) === searchDateClean || f.getName() === date) {
        dateFolder = f;
        break;
      }
    }
    if (!dateFolder) throw new Error("Date folder not found for: " + date);
    
    const reportName = reportNo ? (reportNo.toString().toLowerCase().startsWith("report") ? reportNo : "report " + reportNo) : "report 1";
    let reportFolder;
    const reportFolders = dateFolder.getFolders();
    while (reportFolders.hasNext()) {
      const f = reportFolders.next();
      if (f.getName().toLowerCase() === reportName.toLowerCase()) {
        reportFolder = f;
        break;
      }
    }
    
    let fileId = "";
    if (reportFolder) {
      const files = reportFolder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const mime = file.getMimeType();
        // Prefer Google Doc, but accept Sheet or PDF as a marker for the folder
        if (mime === MimeType.GOOGLE_DOCS || mime === "application/vnd.google-apps.document") {
          fileId = file.getId();
          break;
        }
        if (file.getName() === "Report_Data_Table") {
          fileId = file.getId();
        }
      }
    }
    
    if (!fileId && reportFolder) fileId = reportFolder.getFiles().next().getId(); // Fallback to any file
    
    if (!fileId) throw new Error("No report files found in " + reportName);
    
    const result = fetchReportFromDoc(fileId); // Now works with any file in the folder
    if (result.status === "success") {
      result.reportNo = reportFolder ? reportFolder.getName() : "report 1";
      result.folderId = (reportFolder || dateFolder).getId();
    }
    return result;
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}


/**
 * HIGH-SPEED MASTER SAVE
 * Consolidates all saving operations into a single request to minimize network overhead on mobile/Mac.
 */
function masterSave(data) {
  const { dept, client, date, reportNo, tableData, reportData, signatures, images, previewHtml, signatureImages } = data;
  
  // 1. Create Folders
  const folders = createFolderHierarchy(dept, client, date, reportNo);
  const { folderId, imagesFolderId, signaturesFolderId } = folders;
  
  // 2. Upload Images (Optimized: Drive API is fast internally)
  const driveImages = (images || []).map((img, idx) => {
    if (img && img.src && img.src.startsWith("data:")) {
      const res = saveImageToDrive(imagesFolderId, img.src, img.fileName || `photo_${idx}.jpg`);
      return { ...img, src: res.fileUrl };
    }
    return img;
  });

  // 3. Upload Signatures
  const updatedSignatures = { ...signatures };
  const updatedSignatureImages = { ...signatureImages };
  
  for (let role in updatedSignatureImages) {
    const b64 = updatedSignatureImages[role];
    if (b64 && b64.startsWith("data:")) {
      const res = saveImageToDrive(signaturesFolderId, b64, `${role}.png`);
      updatedSignatureImages[role] = res.fileUrl;
      
      // Sync back to signatures object for spreadsheet
      const sigRoles = ["Tested_By", "Reviewed_By", "Reviewed_Witness_By_1", "Reviewed_Witness_By_2"];
      const sigIdx = sigRoles.indexOf(role);
      if (sigIdx !== -1) {
        const sigId = `sig_${sigIdx}`;
        if (updatedSignatures[sigId]) updatedSignatures[sigId].image = res.fileUrl;
      }
    }
  }

  // 4. Save Sheet
  const sheetRes = generateDataTableSheet(folderId, tableData, dept, reportData, updatedSignatures, driveImages);

  // 5. Generate Report Doc/PDF
  const docRes = generateReportDoc(folderId, reportData, tableData, updatedSignatureImages, dept, driveImages, previewHtml);

  const response = {
    status: "success",
    folderId,
    folderUrl: folders.folderUrl,
    reportNo: folders.reportName,
    pdfUrl: docRes.pdfUrl,
    docUrl: docRes.docUrl,
    sheetUrl: sheetRes.sheetUrl
  };

  try {
    logReportToTrackingSheet(folderId, dept, client, date, folders.reportName, docRes.pdfUrl, docRes.docUrl, sheetRes.sheetUrl);
  } catch (e) {
    console.error("Tracking sheet log failed: " + e.toString());
  }

  return response;
}

const TRACKING_SHEET_NAME = "Masterscan_Report_Tracking";

/**
 * Accesses or creates the central tracking spreadsheet and configures sheets.
 */
function getTrackingSpreadsheet() {
  const root = getRootFolder();
  const files = root.getFilesByName(TRACKING_SHEET_NAME);
  let ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.openById(files.next().getId());
  } else {
    ss = SpreadsheetApp.create(TRACKING_SHEET_NAME);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(root);
    
    // Initialize Tracking sheet
    const sheet = ss.getSheets()[0];
    sheet.setName("Tracking");
    const headers = [
      "Folder ID", "Dept", "Client", "Date", "Report No", 
      "Tech Status", "Client Status", "Delivery Status", 
      "PDF URL", "Doc URL", "Sheet URL", "Client Email", 
      "Timestamp"
    ];
    sheet.appendRow(headers);
    
    // Initialize Users sheet
    const usersSheet = ss.insertSheet("Users");
    usersSheet.appendRow(["Username", "Password", "Role", "ClientName"]);
    usersSheet.appendRow(["admin", "admin123", "Admin", ""]);
    usersSheet.appendRow(["tech1", "tech123", "Technician", ""]);
    usersSheet.appendRow(["level3", "level3123", "LevelIII", ""]);
    usersSheet.appendRow(["client1", "client123", "Client", "CLIENT1"]);
    usersSheet.appendRow(["client2", "client123", "Client", "CLIENT2"]);
  }
  return ss;
}

/**
 * Validates user login credentials against the database.
 */
function loginUser(username, password) {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    const values = sheet.getDataRange().getValues();
    
    // Fallback static users if sheet is empty or only has headers
    const fallbackUsers = [
      { u: "admin", p: "admin123", r: "Admin", c: "" },
      { u: "tech1", p: "tech123", r: "Technician", c: "" },
      { u: "level3", p: "level3123", r: "LevelIII", c: "" },
      { u: "client1", p: "client123", r: "Client", c: "CLIENT1" },
      { u: "client2", p: "client123", r: "Client", c: "CLIENT2" }
    ];

    const cleanUsername = (username || "").trim().toLowerCase();
    const cleanPassword = (password || "").trim();

    // Check Sheet
    for (let i = 1; i < values.length; i++) {
      const u = (values[i][0] || "").toString().trim().toLowerCase();
      const p = (values[i][1] || "").toString().trim();
      const role = (values[i][2] || "").toString().trim();
      const clientName = (values[i][3] || "").toString().trim();
      
      if (u === cleanUsername && p === cleanPassword) {
        return { status: "success", username: values[i][0], role, clientName };
      }
    }
    
    // Fallback Check
    const foundFallback = fallbackUsers.find(user => user.u === cleanUsername && user.p === cleanPassword);
    if (foundFallback) {
      // Re-seed sheet if missing
      try {
        sheet.appendRow([foundFallback.u, foundFallback.p, foundFallback.r, foundFallback.c]);
      } catch (err) {}
      return { status: "success", username: foundFallback.u, role: foundFallback.r, clientName: foundFallback.c };
    }
    
    return { status: "error", message: "Invalid username or password" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Returns all registered users from the Users sheet.
 */
function getUsersList() {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    const values = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < values.length; i++) {
      users.push({
        username: values[i][0],
        password: values[i][1],
        role: values[i][2],
        clientName: values[i][3]
      });
    }
    return { status: "success", users: users };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Generates unique client user credentials, saves to spreadsheet, and sends details via email.
 */
function createClientUser(clientName, email) {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Users");
    const values = sheet.getDataRange().getValues();
    
    const cleanClientName = clientName.trim();
    const username = "client_" + cleanClientName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    
    // Check if client user already exists
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === username) {
        return { 
          status: "success", 
          username: values[i][0], 
          password: values[i][1],
          message: "Client user already exists"
        };
      }
    }
    
    // Generate a simple random password
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Add to Users sheet
    sheet.appendRow([username, password, "Client", cleanClientName.toUpperCase()]);
    
    // Send email with credentials
    const webAppUrl = ScriptApp.getService().getUrl();
    const subject = `Masterscan Client Portal Access Credentials - ${cleanClientName}`;
    const body = `Dear Client,

An account has been created for you to access the Masterscan NDT Reporting Client Portal.

Please use the following credentials to log in:
- Portal URL: ${webAppUrl || "Please use the Masterscan Reporting application link"}
- Username: ${username}
- Password: ${password}

Using the Client Portal, you can review, witness, and verify (approve or reject) all inspection reports for your projects.

Best regards,
Masterscan Engineering Pte Ltd`;

    try {
      MailApp.sendEmail({
        to: email.trim(),
        subject: subject,
        body: body
      });
    } catch (mailErr) {
      console.warn("Could not send credentials email: " + mailErr.toString());
    }
    
    return { status: "success", username: username, password: password };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Retrieves lists of client reports from the central tracking sheet.
 */
function getReportsList(role, clientName) {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Tracking");
    const values = sheet.getDataRange().getValues();
    const reports = [];
    
    if (values.length <= 1) return { status: "success", reports: [] };
    
    const headers = values[0];
    const isClient = (role === "Client");
    const filterClient = (clientName || "").trim().toLowerCase();
    
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const rClient = (row[2] || "").toString().trim().toLowerCase();
      
      // If client, restrict access to their own reports
      if (isClient && rClient !== filterClient) {
        continue;
      }
      
      reports.push({
        folderId: row[0],
        dept: row[1],
        client: row[2],
        date: row[3],
        reportNo: row[4],
        techStatus: row[5] || "Draft",
        clientStatus: row[6] || "Pending Verification",
        deliveryStatus: row[7] || "Not Sent",
        pdfUrl: row[8],
        docUrl: row[9],
        sheetUrl: row[10],
        clientEmail: row[11],
        timestamp: row[12]
      });
    }
    
    // Sort reverse-chronologically by timestamp
    reports.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    
    return { status: "success", reports };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Updates a specific status field in the tracking spreadsheet.
 */
function updateReportStatus(folderId, statusField, statusValue) {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Tracking");
    const values = sheet.getDataRange().getValues();
    
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === folderId) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) throw new Error("Report not found in tracking database");
    
    // Map status fields to column indices (1-indexed)
    // 6: Tech Status, 7: Client Status, 8: Delivery Status
    let colIndex = -1;
    if (statusField === "techStatus") colIndex = 6;
    else if (statusField === "clientStatus") colIndex = 7;
    else if (statusField === "deliveryStatus") colIndex = 8;
    
    if (colIndex === -1) throw new Error("Invalid status field: " + statusField);
    
    sheet.getRange(rowIndex, colIndex).setValue(statusValue);
    
    return { status: "success", message: "Status updated successfully" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Logs a report save operation to the central tracking sheet.
 */
function logReportToTrackingSheet(folderId, dept, client, date, reportNo, pdfUrl, docUrl, sheetUrl) {
  const ss = getTrackingSpreadsheet();
  const sheet = ss.getSheetByName("Tracking");
  const values = sheet.getDataRange().getValues();
  
  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === folderId) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const timestamp = new Date().toISOString();
  
  if (rowIndex !== -1) {
    // Update existing row (Dept, Client, Date, ReportNo, PDF, Doc, Sheet, Timestamp)
    sheet.getRange(rowIndex, 2, 1, 4).setValues([[dept, client, date, reportNo]]);
    sheet.getRange(rowIndex, 9, 1, 3).setValues([[pdfUrl, docUrl, sheetUrl]]);
    sheet.getRange(rowIndex, 13).setValue(timestamp);
  } else {
    // Append new tracking row
    sheet.appendRow([
      folderId,
      dept,
      client,
      date,
      reportNo,
      "Draft",                 // Default tech status
      "Pending Verification",  // Default client status
      "Not Sent",              // Default delivery status
      pdfUrl,
      docUrl,
      sheetUrl,
      "",                      // Default client email
      timestamp
    ]);
  }
}

/**
 * Sends a report PDF to client email and updates delivery details.
 */
function sendReportEmail(folderId, recipientEmail) {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Tracking");
    const values = sheet.getDataRange().getValues();
    
    let rowIndex = -1;
    let reportData = null;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === folderId) {
        rowIndex = i + 1;
        reportData = {
          folderId: values[i][0],
          dept: values[i][1],
          client: values[i][2],
          date: values[i][3],
          reportNo: values[i][4]
        };
        break;
      }
    }
    
    if (!reportData) throw new Error("Report not found in tracking sheet.");
    
    // Find PDF in Google Drive folder
    const folder = DriveApp.getFolderById(folderId);
    const pdfFiles = folder.getFilesByType(MimeType.PDF);
    let pdfFile = null;
    if (pdfFiles.hasNext()) {
      pdfFile = pdfFiles.next();
    } else {
      // Fallback search
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getName().toLowerCase().endsWith(".pdf")) {
          pdfFile = f;
          break;
        }
      }
    }
    
    if (!pdfFile) throw new Error("PDF report document not found in report folder.");
    
    const subject = `Masterscan NDT Report for Verification - ${reportData.client} - ${reportData.dept} - ${reportData.reportNo}`;
    const body = `Dear Client,

Please find attached the NDT Inspection Report (${reportData.dept}) for your review and verification.

Report Details:
- Department: ${reportData.dept}
- Client: ${reportData.client}
- Date: ${reportData.date}
- Report No: ${reportData.reportNo}

Please log in to the Masterscan Reporting portal to approve or reject this report.

Best regards,
Masterscan Engineering Pte Ltd`;
    
    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      body: body,
      attachments: [pdfFile.getAs(MimeType.PDF)]
    });
    
    // Update delivery details in tracking spreadsheet
    sheet.getRange(rowIndex, 8).setValue("Sent");
    sheet.getRange(rowIndex, 12).setValue(recipientEmail);
    
    return { status: "success", message: "Email sent successfully to " + recipientEmail };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Traverses current Google Drive folders to index existing reports to central database.
 */
function reindexExistingReports() {
  try {
    const ss = getTrackingSpreadsheet();
    const sheet = ss.getSheetByName("Tracking");
    const existingFolderIds = new Set(sheet.getDataRange().getValues().slice(1).map(row => row[0]));
    
    const root = getRootFolder();
    const deptFolders = root.getFolders();
    let indexCount = 0;
    
    while (deptFolders.hasNext()) {
      const deptFolder = deptFolders.next();
      const dept = deptFolder.getName();
      if (dept === "Images" || dept === "Signatures" || dept === TRACKING_SHEET_NAME) continue;
      
      const clientFolders = deptFolder.getFolders();
      while (clientFolders.hasNext()) {
        const clientFolder = clientFolders.next();
        const clientName = clientFolder.getName();
        
        const dateFolders = clientFolder.getFolders();
        while (dateFolders.hasNext()) {
          const dateFolder = dateFolders.next();
          const dateStr = dateFolder.getName();
          
          const reportFolders = dateFolder.getFolders();
          while (reportFolders.hasNext()) {
            const reportFolder = reportFolders.next();
            const reportId = reportFolder.getId();
            const reportName = reportFolder.getName();
            
            if (existingFolderIds.has(reportId)) continue;
            
            let pdfUrl = "";
            let docUrl = "";
            let sheetUrl = "";
            
            const files = reportFolder.getFiles();
            while (files.hasNext()) {
              const file = files.next();
              const mime = file.getMimeType();
              const fileName = file.getName();
              
              if (mime === MimeType.PDF || fileName.endsWith(".pdf")) {
                pdfUrl = file.getUrl();
              } else if (mime === MimeType.GOOGLE_DOCS || fileName.includes("_20") || fileName.includes(clientName)) {
                docUrl = file.getUrl();
              } else if (fileName === "Report_Data_Table") {
                sheetUrl = file.getUrl();
              }
            }
            
            const timestamp = new Date(reportFolder.getLastUpdated()).toISOString();
            
            sheet.appendRow([
              reportId,
              dept,
              clientName,
              dateStr,
              reportName,
              "Approved",            // Assume existing are Approved
              "Pending Verification",// Default client status
              "Not Sent",            // Default delivery status
              pdfUrl,
              docUrl,
              sheetUrl,
              "",
              timestamp
            ]);
            indexCount++;
          }
        }
      }
    }
    
    return { status: "success", count: indexCount, message: `Successfully reindexed ${indexCount} reports.` };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}
