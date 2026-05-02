function doGet() {
  // Use createHtmlOutputFromFile to bypass template processor
  // This avoids parsing issues with very large HTML files and prevents
  // Google Apps Script from trying to process $ signs in CSS selectors
  try {
    return HtmlService.createHtmlOutputFromFile("index")
      .setTitle("Motion Dashboard")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  } catch (error) {
    Logger.log("Error with createHtmlOutputFromFile: " + error.toString());
    // Fallback to template method (should not be needed)
    return HtmlService.createTemplateFromFile("index")
      .evaluate()
      .setTitle("Motion Dashboard")
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}