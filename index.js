const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const fs = require('fs');
const schedule = require('node-schedule');
const axios = require('axios');
const { Timestamp } = require('firebase-admin/firestore');
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
    const logMessage = `${DateTime.now()}: ${message}\n`;
    fs.appendFileSync('cronjob.log', logMessage); // Write log message to cronjob.log
}


async function notifyEmergencyContacts(userDoc, alertDoc, userId, alertTableId) {
    return new Promise(async (resolve, reject) => {
        try {
            const userData = userDoc.data();
            const alertData = alertDoc.data();
            const userName = userData.FullName;
            const lastName = userData.LastName;
            const userCountryCode = userData.UserCountryCode;
            const userWsNo = userData.WhatsAppNo;
            const fullUserContact1 = `${userCountryCode.replace('+', '')}${userWsNo}`;
            const tripName = alertData.TripName;
            const tripUrl = `${process.env.VERCEL_APP_URL}/share?alertTableId=${alertTableId}`
            const expectedReturnTime = alertData.ReturnTimestamp?.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              }).replace(/(\w{3})/, (month) => month.toUpperCase()) + ' • ' + new Date(BackAndSafeTime.seconds * 1000).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });;
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
                        name: "emergency_alert_sent_beta",
                        language: {
                            code: "en"
                        },
                        components: [
                            {
                                type: "body",
                                parameters: [
                                    { type: "text", text: userName },
                                    { type: "text", text: fullUserContact1 },
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
                        name: "emergency_alert_sent_beta",
                        language: {
                            code: "en"
                        },
                        components: [
                            {
                                type: "body",
                                parameters: [
                                    { type: "text", text: userName },
                                    { type: "text", text: fullUserContact1 },
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
            resolve(true);
        } catch (error) {
            const currentTime=Timestamp.now()

            await db.collection('CronJobLogs').add({
                CronJobLogs: 'Failed',
                TimeOfCronLog: currentTime,
                Error: error.message, // Log the error message
            });
            reject(error);
        }
    });
}


async function sendWhatsAppMessageToUser(userDoc, alertDoc) {
    return new Promise(async (resolve, reject) => {
        try {
            const userData = userDoc.data();
            const alertData = alertDoc.data();
            const userName = userData.FullName;
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
                        name: 'trip_safety_check_beta',
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
            if (response.status === 200) {
                resolve(response);
            } else {
                // Handle unexpected response status
                console.error(`Unexpected response status: ${response.statusText}`);
                reject(new Error(`Failed to send WhatsApp message. Status: ${response.statusText}`));
            }
        } catch (error) {
            const currentTime=Timestamp.now()
            await db.collection('CronJobLogs').add({
                CronJobLogs: 'Failed',
                TimeOfCronLog: currentTime,
                Error: error.message, // Log the error message
            });
            // Handle errors from the sendWhatsAppMessage function
            console.error(`Error sending WhatsApp message: ${error.message}`);
            reject(new Error(`Failed to send WhatsApp message: ${error.message}`));
        }
    }
    );
}


async function processDocuments() {
    const lockRef = db.collection('Locks').doc('alertProcessing');

    try {
        // Try to acquire a lock
        const lockResult = await db.runTransaction(async (transaction) => {
            const lockDoc = await transaction.get(lockRef);
            if (lockDoc.exists && lockDoc.data().locked && lockDoc.data().lockedAt > Date.now() - 5 * 60 * 1000) {
                return false; // Lock is held and not expired
            }
            transaction.set(lockRef, { locked: true, lockedAt: Date.now() });
            return true;
        });

        if (!lockResult) {
            writeLog('Another instance is currently processing. Skipping this run.');
            return 'Skipped';
        }

        const snapshot = await db.collection('AlertTable')
            .where('isAlertSent', '==', false)
            .where('IsTripCompleted', '==', false)
            .get();

        const batch = db.batch();
        const processedDocs = [];

        for (const doc of snapshot.docs) {
            const docData = doc.data();
            const returnTimestamp = docData.ReturnTimestamp?.toDate();
            const userId = docData.UserId;
            const isAlertSentToUser = docData.isAlertSentToUser || false;
            const returnUTC = DateTime.fromJSDate(returnTimestamp, { zone: 'utc' });
            const currentUTC = DateTime.utc();

            if (!docData.isAlertSent && !docData.IsTripCompleted && !isAlertSentToUser && returnUTC < currentUTC) {
                await sendNotificationAndUpdateDocuments(batch, doc.id, userId, 1, doc);
                processedDocs.push(doc.id);
            } else if (!docData.isAlertSent && isAlertSentToUser && !docData.IsTripCompleted && returnUTC < currentUTC) {
                const diffInMinutes = currentUTC.diff(returnUTC, 'minutes').minutes;
                if (diffInMinutes > 60) {
                    await sendNotificationAndUpdateDocuments(batch, doc.id, userId, 2, doc);
                    processedDocs.push(doc.id);
                }
            }
        }

        if (processedDocs.length > 0) {
            await batch.commit();
            writeLog(`Processed ${processedDocs.length} documents: ${processedDocs.join(', ')}`);
        } else {
            writeLog('No documents needed processing');
        }
        return 'OK';
    } catch (error) {
        const currentTime=Timestamp.now()

        await db.collection('CronJobLogs').add({
            CronJobLogs: 'Failed',
            TimeOfCronLog: currentTime,
            Error: error.message, // Log the error message
        });
        writeLog(`Error processing documents: ${error.message}`);
        return 'Error';
    } finally {
        // Release the lock
        await lockRef.set({ locked: false });
    }
}

// Modify the sendNotificationAndUpdateDocuments function to work with batches
async function sendNotificationAndUpdateDocuments(batch, alertTableId, userId, eventId, alertDoc) {
    try {
        const userRef = db.collection('UserTable').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            throw new Error(`User document with ID ${userId} does not exist`);
        }

        const alertRef = db.collection('AlertTable').doc(alertTableId);

        let res = false;

        if (eventId === 2) {
            if (!alertDoc.isAlertSent) {
                res = await notifyEmergencyContacts(userDoc, alertDoc, userId, alertTableId);
                if (res) {
                    batch.update(alertRef, {
                        AlertedTimestamp: new Date(),
                        isAlertSent: true
                    });
                }
            }
        } else {
            if (!alertDoc.isAlertSentToUser) {
                res = await sendWhatsAppMessageToUser(userDoc, alertDoc);
                if (res) {
                    const messageId = res.data.messages[0].id; // Extract the message ID from the response
                    batch.set(db.collection('WhatsAppLog').doc(messageId), {
                        alertTableId,
                        userId
                      });
                    batch.update(alertRef, {
                        UserAlertTimeStamp: new Date(),
                        isAlertSentToUser: true
                    });
                }
            }
        }
        writeLog(`Notification sent for AlertTable ID: ${alertTableId}`);
    } catch (error) {
        const currentTime=Timestamp.now()

            await db.collection('CronJobLogs').add({
                CronJobLogs: 'Failed',
                TimeOfCronLog: currentTime,
                Error: error.message, // Log the error message
            });
        writeLog(`Error processing document ${alertTableId}: ${error.message}`);
        throw error;
    }
}

async function addCronJobLog() {
    try {
        const currentTime=Timestamp.now()

        await db.collection('CronJobLogs').doc('LastExecution').set({
            CronJobLogs: 'Success',
            TimeOfCronLog: currentTime,
        });
        writeLog('Scheduled job executed successfully.');
    } catch (error) {
        writeLog(`Scheduled job failed: ${error.message}`);
    }
}

schedule.scheduleJob('*/15 * * * *', async () => {
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
        console.log("SERVER JAGTEH RAHO!!!");
        await addCronJobLog();
        return res.status(200).send('OK'); // Respond with a simple "OK" message
    } catch (error) {
        return res.status(500).send('Error'); // Respond with a simple "Error" message
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
