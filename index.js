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
        if (userDoc.exists) {
            if (eventId == 2) {
                const res = await sendWhatsAppMessageToEmergencyContacts(userDoc, alertDoc, userId, alertTableId);
                if (res) {
                    await db.collection('AlertTable').doc(alertTableId).update({
                        AlertedTimestamp: new Date(),
                        isAlertSent: true,
                    });
                }
            } else {
                const res = await sendWhatsAppMessageToUser(userDoc, alertDoc, userId, alertTableId);
                if (res) {
                    await db.collection('AlertTable').doc(alertTableId).update({
                        UserAlertTimeStamp: new Date(),
                        isAlertSentToUser: true,
                    });
                }
            }
        }

        // Write a general log for notification sent
        writeLog(`Notification sent and document updated for AlertTable ID: ${alertTableId}`);
    } catch (error) {
        // Log error in Firebase and to a log file
        await db.collection('CronJobLogs').add({
            CronJobLogs: 'Failed',
            TimeOfCronLog: DateTime.now().toISO(),
            Error: error.message, // Log the error message
        });
        writeLog(`Error updating document ${alertTableId}: ${error.message}`);
        throw error; // Re-throw to be caught by the calling function
    } 
}

async function sendWhatsAppMessageToEmergencyContacts(userDoc, alertDoc, userId, alertTableId) {
    try {
        // Get emergency contact information
        const userData = userDoc.data();
        const alertData = alertDoc.data();
        const userName = userData.FirstName;
        const lastName = userData.LastName;
        const userCountryCode = userData.UserCountryCode;
        const userWsNo = userData.WhatsAppNo;
        const fullUserContact1 = `${userCountryCode.replace('+', '')}${userWsNo}`;
        const tripName = alertData.TripName;
        const tripUrl = `${process.env.VERCEL_APP_URL}/trip?userId=${userId}&alertTableId=${alertTableId}`
        const expectedReturnTime = alertData.ReturnTimestamp?.toDate();
        const emergencyContact1Name = userData.EmergencyContact1Name;
        const emergencyContact1CountryCode = userData.EmergencyContact1CountryCode;
        const emergencyContact1 = userData.EmergencyContact1;
        const emergencyContact2Name = userData.EmergencyContact2Name;
        const emergencyContact2CountryCode = userData.EmergencyContact2CountryCode;
        const emergencyContact2 = userData.EmergencyContact2;
        const fullEmergencyContact1 = `${emergencyContact1CountryCode.replace('+', '')}${emergencyContact1}`;
        const fullEmergencyContact2 = `${emergencyContact2CountryCode.replace('+', '')}${emergencyContact2}`;

        const response = await axios.post(
            process.env.FACEBOOK_GRAPH_API_URL,
            {
                messaging_product: "whatsapp",
                to: fullEmergencyContact1,
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
                                { type: "text", text: expectedReturnTime },
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
        const response2 = await axios.post(
            process.env.FACEBOOK_GRAPH_API_URL,
            {
                messaging_product: "whatsapp",
                to: fullEmergencyContact2,
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
                                { type: "text", text: expectedReturnTime },
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

        if (response2.status === 200 && response.status === 200) {
            const response3 = await axios.post(
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

            if (response3.status === 200) {
                console.log('Emergency alert sent successfully:', response.data);
            }
        }
        return true;
    } catch (error) {
        writeLog(`Failed to send WhatsApp message to : ${error.message}`);
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

        // Process each document in AlertTable
        for (const doc of snapshot.docs) {
            const docData = doc.data();
            const returnTimestamp = docData.ReturnTimestamp?.toDate();
            const userId = docData.UserId;
            const isAlertSentToUser = docData.isAlertSentToUser || false;
            const returnUTC = DateTime.fromJSDate(returnTimestamp, { zone: 'utc' });
            const currentUTC = DateTime.utc();

            if (!docData.isAlertSent && !docData.IsTripCompleted && !isAlertSentToUser && returnUTC < currentUTC) {
                await sendNotificationAndUpdateDocuments(doc.id, userId, 1, doc);
            }

            if (!docData.isAlertSent && isAlertSentToUser && !docData.IsTripCompleted && returnUTC < currentUTC) {
                const diffInMinutes = currentUTC.diff(returnUTC, 'minutes').minutes;
                if (diffInMinutes > 15) {
                    await sendNotificationAndUpdateDocuments(doc.id, userId, 2, doc);
                }
            }
        }

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
schedule.scheduleJob('*/5* * * *', async () => {
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
