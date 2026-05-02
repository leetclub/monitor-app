function sendSlackMessage(message, channel) {
  try {
    // Use Script Property SLACK_WEBHOOK_URL first, then config SLACK_WEBHOOK_URL, then default (Delay Risk strike uses this)
    var webhookUrl = (function () {
      try {
        var u = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
        if (u && u.trim()) return u.trim();
      } catch (e) {}
      if (typeof SLACK_WEBHOOK_URL !== 'undefined' && SLACK_WEBHOOK_URL) return SLACK_WEBHOOK_URL;
      return '';
    })();
    const proxyUrl = 'https://surveyapi.theleetclub.com/?url=';
    const fullUrl = proxyUrl + webhookUrl;
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: message }),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(fullUrl, options);
    
    if (response.getResponseCode() === 200) {
      return { success: true, message: "Message sent successfully" };
    } else {
      return { success: false, error: `Failed to send message. Status code: ${response.getResponseCode()}` };
    }
  } catch (error) {
    console.error("Error sending Slack message:", error);
    return { success: false, error: error.toString() };
  }
}


function sendEnhancedStrikeNotification(messageData) {
  try {
    // Send to channel
    const channelResult = sendSlackMessage(messageData.text, `strike${messageData.strikeNumber}`);
    
    // Send to operators
    let operatorResults = { success: false, message: "No machine ID provided" };
    
    if (messageData.machineId) {
      operatorResults = sendDirectMessagesToOperators(messageData);
    }
    
    return {
      success: channelResult.success || operatorResults.success,
      channelResult: channelResult,
      operatorResults: operatorResults
    };
  } catch (error) {
    console.error("Error sending enhanced notification:", error);
    return { success: false, error: error.toString() };
  }
}


function sendDirectMessagesToOperators(messageData) {
  try {
    const allUsers = fetchUsers();
    const operators = findUserForMachine(messageData.machineId, allUsers);
    
    const results = {
      success: false,
      sent: [],
      errors: []
    };
    
    // Build the strike message
    const strikeMessage = messageData.text || `⚠️ *STRIKE ${messageData.strikeNumber}* ⚠️\nEvent Type: ${messageData.eventType || 'Unknown'}\nMachine: ${messageData.machineName || 'Unknown'}\nTimestamp: ${messageData.timestamp || new Date().toLocaleString()}`;
    
    operators.forEach(operator => {
      if (!operator.email) {
        results.errors.push(`No email for operator: ${operator.name}`);
        return;
      }
      
      try {
        // Try to get Slack user ID from user data or Script Properties
        var slackUserId = null;
        
        // Check if operator has slack_id in user details
        try {
          var userDetails = fetchUserDetails(operator.id);
          if (userDetails && (userDetails.slack_id || userDetails.slack_user_id || userDetails.slackId)) {
            slackUserId = userDetails.slack_id || userDetails.slack_user_id || userDetails.slackId;
          }
        } catch (e) {
          // Ignore - will try Script Properties
        }
        
        // Check Script Properties for Slack user ID
        if (!slackUserId) {
          try {
            var props = PropertiesService.getScriptProperties();
            var propKey = 'SLACK_USER_ID_' + operator.email.replace(/[@.]/g, '_');
            var slackId = props.getProperty(propKey);
            if (slackId && slackId.trim()) {
              slackUserId = slackId.trim();
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Send DM using Slack user ID if available, otherwise try email lookup
        var dmResult = null;
        if (slackUserId) {
          // Use Slack user ID directly (no email lookup needed)
          console.log(`Sending DM to ${operator.name} (${operator.email}) using Slack user ID: ${slackUserId}`);
          dmResult = sendSlackDMByUserId(slackUserId, strikeMessage);
        } else {
          // Fall back to email lookup (requires users:read.email scope)
          console.log(`Sending DM to ${operator.name} (${operator.email}) using email lookup`);
          dmResult = sendSlackDMByEmail(operator.email, strikeMessage);
        }
        
        if (dmResult && dmResult.success) {
          results.sent.push({
            name: operator.name,
            email: operator.email
          });
          results.success = true;
        } else {
          var errorMsg = dmResult ? dmResult.error : 'Unknown error';
          results.errors.push(`Failed to send to ${operator.name} (${operator.email}): ${errorMsg}`);
        }
      } catch (opError) {
        results.errors.push(`Error sending to ${operator.name}: ${opError.message}`);
      }
    });
    
    return results;
  } catch (error) {
    console.error("Error in sendDirectMessagesToOperators:", error);
    return { success: false, error: error.toString() };
  }
}