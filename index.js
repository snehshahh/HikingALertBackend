const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Ensure the key is formatted correctly
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();

// Log function to write logs to a file
function writeLog(message) {
    const logMessage = `${DateTime.now().toISO()}: ${message}\n`;
    fs.appendFileSync('cronjob.log', logMessage); // Write log message to cronjob.log
}

async function sendNotificationAndUpdateDocuments(alertTableId, userId, eventId, alertDoc) {
  try {
      const userDoc = await db.collection('UserTable').doc(userId).get();
      if (!userDoc.exists) {
          throw new Error(`User document with ID ${userId} does not exist`);
      }

      // Use a transaction to ensure consistency
      await db.runTransaction(async (transaction) => {
          const alertRef = db.collection('AlertTable').doc(alertTableId);
          const alertSnapshot = await transaction.get(alertRef);

          if (!alertSnapshot.exists) {
              throw new Error(`Alert document with ID ${alertTableId} does not exist`);
          }

          const alertData = alertSnapshot.data();

          let res = false;

          if (eventId === 2) {
              // Check if messages have already been sent to emergency contacts
              if (!alertData.isAlertSent) {
                  res = await sendWhatsAppMessageToEmergencyContacts(userDoc, alertSnapshot, userId, alertTableId);
                  if (res) {
                      transaction.update(alertRef, {
                          AlertedTimestamp: new Date(),
                          isAlertSent: true
                      });
                  }
              }
          } else {
              // Check if the message has already been sent to the user
              if (!alertData.isAlertSentToUser) {
                  res = await sendWhatsAppMessageToUser(userDoc, alertSnapshot, userId, alertTableId);
                  if (res) {
                      transaction.update(alertRef, {
                          UserAlertTimeStamp: new Date(),
                          isAlertSentToUser: true
                      });
                  }
              }
          }
      });

      // Write a general log for notification sent
      writeLog(`Notification sent and document updated for AlertTable ID: ${alertTableId}`);
  } catch (error) {
      // Log error in Firebase and to a log file
      await db.collection('CronJobLogs').add({
          CronJobLogs: 'Failed',
          TimeOfCronLog: DateTime.now().toISO(),
          Error: error.message,
      });
      writeLog(`Error updating document ${alertTableId}: ${error.message}`);
      throw error; // Re-throw to be caught
  }
}


async function sendWhatsAppMessageToEmergencyContacts(userDoc, alertDoc, userId, alertTableId) {
    try {
      // Extract user and alert data
      const userData = userDoc.data();
      const alertData = alertDoc.data();
      const userName = userData.FirstName;
      const lastName = userData.LastName;
      const userCountryCode = userData.UserCountryCode;
      const userWsNo = userData.WhatsAppNo;
      const fullUserContact1 = `${userCountryCode.replace('+', '')}${userWsNo}`;
      const tripName = alertData.TripName;
      const tripUrl = `${process.env.VERCEL_APP_URL}/trip?userId=${userId}&alertTableId=${alertTableId}`;
      const expectedReturnTime = alertData.ReturnTimestamp?.toDate();
      
      const emergencyContacts = [
        {
          name: userData.EmergencyContact1Name,
          number: `${userData.EmergencyContact1CountryCode.replace('+', '')}${userData.EmergencyContact1}`,
          isMessageSent: false // Control flag
        },
        {
          name: userData.EmergencyContact2Name,
          number: `${userData.EmergencyContact2CountryCode.replace('+', '')}${userData.EmergencyContact2}`,
          isMessageSent: false // Control flag
        }
      ];
  
      // Send message to emergency contacts
      for (const contact of emergencyContacts) {
        if (!contact.isMessageSent) {
          const response = await axios.post(
            process.env.FACEBOOK_GRAPH_API_URL,
            {
              messaging_product: "whatsapp",
              to: contact.number,
              type: "template",
              template: {
                name: "emergency_alert_detailed",
                language: {
                  code: "en"
                },
                components: [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: userName },
                      { type: "text", text: lastName },
                      { type: "text", text: expectedReturnTime}, // Convert to ISO string for readable format
                      { type: "text", text: tripName },
                      { type: "text", text: tripUrl },
                      { type: "text", text: "https://rushlabs.com/alerts" }
                    ]
                  }
                ]
              }
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.FACEBOOK_GRAPH_API_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (response.status === 200) {
            contact.isMessageSent = true; // Set flag to true after successful send
          } else {
            console.error(`Failed to send message to ${contact.name}: ${response.statusText}`);
          }
        }
      }
  
      // Send message to user after emergency contacts
      if (emergencyContacts.every(contact => contact.isMessageSent)) {
        const responseToUser = await axios.post(
          process.env.FACEBOOK_GRAPH_API_URL,
          {
            messaging_product: "whatsapp",
            to: fullUserContact1,
            type: "template",
            template: {
              name: "emergency_alert_sent",
              language: {
                code: "en"
              },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: userName },
                    { type: "text", text: tripName },
                    { type: "text", text: tripUrl }
                  ]
                }
              ]
            }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.FACEBOOK_GRAPH_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (responseToUser.status === 200) {
          console.log('Emergency alert sent successfully to user:', responseToUser.data);
        } else {
          console.error('Failed to send emergency alert to user:', responseToUser.statusText);
        }
      }
  
      return true;
    } catch (error) {
      writeLog(`Failed to send WhatsApp message: ${error.message}`);
      throw error;
    }
  }
  

async function sendWhatsAppMessageToUser(userDoc, alertDoc) {
    try {
        const userData = userDoc.data();
        const alertData = alertDoc.data();
        const userName = userData.FirstName;
        const userCountryCode = userData.UserCountryCode;
        const userWsNo = userData.WhatsAppNo;
        const fullUserContact1 = `${userCountryCode.replace('+', '')}${userWsNo}`;
        const tripName = alertData.TripName;
        const response = await axios.post(
            process.env.FACEBOOK_GRAPH_API_URL,
            {
                messaging_product: 'whatsapp',
                to: fullUserContact1,
                type: 'template',
                template: {
                    name: 'trip_safety_check_3',
                    language: {
                        code: 'en',
                    },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                {
                                    type: 'text',
                                    text: userName,
                                },
                                {
                                    type: 'text',
                                    text: tripName,
                                },
                                {
                                    type: 'text',
                                    text: alertDoc.id,
                                },
                            ],
                        },
                    ],
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.FACEBOOK_GRAPH_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('Message sent successfully:', response.data);
        writeLog(`WhatsApp message sent to ${response.data}`);
        return true;
    } catch (error) {
        writeLog(`Failed to send WhatsApp message to ${error.message}`);
        throw error;
    }
}


// Function to check document status and send notifications if necessary
async function processDocuments() {
  const collectionName = 'AlertTable';

  try {
      const snapshot = await db.collection(collectionName)
          .where('isAlertSent', '==', false)
          .where('IsTripCompleted', '==', false)
          .get();

      // Create an array of promises
      const promises = snapshot.docs.map(doc => {
          return db.runTransaction(async (transaction) => {
              const docRef = db.collection(collectionName).doc(doc.id);
              const docData = (await transaction.get(docRef)).data();
              if (!docData) {
                  throw new Error(`Document ${doc.id} not found`);
              }

              const returnTimestamp = docData.ReturnTimestamp?.toDate();
              const userId = docData.UserId;
              const isAlertSentToUser = docData.isAlertSentToUser || false;
              const returnUTC = DateTime.fromJSDate(returnTimestamp, { zone: 'utc' });
              const currentUTC = DateTime.utc();

                if (!docData.isAlertSent && !docData.IsTripCompleted && !isAlertSentToUser && returnUTC < currentUTC) {
                    await sendNotificationAndUpdateDocuments(transaction, doc.id, userId, 1, docData);
                }
                if (!docData.isAlertSent && isAlertSentToUser && !docData.IsTripCompleted && returnUTC < currentUTC) {
                    const diffInMinutes = currentUTC.diff(returnUTC, 'minutes').minutes;
                    if (diffInMinutes > 60) {
                        await sendNotificationAndUpdateDocuments(transaction, doc.id, userId, 2, docData);
                    }
                }
            });
        });
        return 'OK';
    } catch (error) {
        writeLog(`Error processing documents: ${error.message}`);
        return 'Error';
    }
}


async function addCronJobLog() {
    try {
        await db.collection('CronJobLogs').add({
            CronJobLogs: 'Success',
            TimeOfCronLog: DateTime.now(),
        });
        writeLog('Scheduled job executed successfully.');
    } catch (error) {
        writeLog(`Scheduled job failed: ${error.message}`);
    }
}

// Schedule the job to run every 15 minutes
const schedule = require('node-schedule');
schedule.scheduleJob('*/5 * * * *', async () => {
    try {
        const results = await processDocuments();
        await addCronJobLog();
        writeLog('Scheduled job executed successfully.');
    } catch (error) {
        writeLog(`Scheduled job failed: ${error.message}`);
    }
});

app.get('/', async (req, res) => {
    try {
        const results = await processDocuments();
        await addCronJobLog();
        return res.status(200).send('OK'); // Respond with a simple "OK" message
    } catch (error) {
        return res.status(500).send('Error'); // Respond with a simple "Error" message
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    writeLog(`Server is running on port ${PORT}`);
});