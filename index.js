const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon'); // Import Luxon for date handling
const fs = require('fs'); // Import fs module to write logs to a file

// Initialize Firebase Admin SDK
const serviceAccount = require('./hikingalert-260bf-firebase-adminsdk-8rkbb-24973cba1e.json');

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

// Function to send a notification, update the document, and log emergency contacts
async function sendNotificationAndUpdateDocuments(alertTableId, userId) {
    try {
        // Update the AlertTable document
        await db.collection('AlertTable').doc(alertTableId).update({
            AlertedTimestamp: new Date(),
            isAlertSent: true,
        });

        // Retrieve emergency contacts from UserTable using the userId
        const userDoc = await db.collection('UserTable').doc(userId).get();

        if (userDoc.exists) {
            const userData = userDoc.data();

            // Get emergency contact information
            const emergencyContact1Name = userData.EmergencyContact1Name;
            const emergencyContact1CountryCode = userData.EmergencyContact1CountryCode;
            const EmergencyContact1 = userData.EmergencyContact1;
            const emergencyContact2Name = userData.EmergencyContact2Name;
            const emergencyContact2CountryCode = userData.EmergencyContact2CountryCode;
            const EmergencyContact2 = userData.EmergencyContact2;

            // Log for EmergencyContact1 (if exists)
            if (emergencyContact1Name && emergencyContact1CountryCode) {
                const fullEmergencyContact1 = `${emergencyContact1CountryCode}${EmergencyContact1}`;
                writeLog(`Notification sent to ${fullEmergencyContact1} for AlertTable ID: ${alertTableId}`);
            }

            // Log for EmergencyContact2 (if exists)
            if (emergencyContact2Name && emergencyContact2CountryCode) {
                const fullEmergencyContact2 = `${emergencyContact2CountryCode}${EmergencyContact2}`;
                writeLog(`Notification sent to ${fullEmergencyContact2} for AlertTable ID: ${alertTableId}`);
            }

            // Log if no contacts found
            if (!emergencyContact1Name && !emergencyContact2Name) {
                writeLog(`No emergency contacts found for User ID: ${userId} (AlertTable ID: ${alertTableId})`);
            }
        } else {
            writeLog(`UserTable document does not exist for User ID: ${userId}`);
        }

        // Write a general log for notification sent
        writeLog(`Notification sent and document updated for AlertTable ID: ${alertTableId}`);
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Failed",
            "TimeOfCronLog": DateTime.now().toISO(),
            "Error": error.message // Log the error message
        });
        writeLog(`Error updating document ${alertTableId}: ${error.message}`);
        throw error; // Re-throw to be caught by the calling function
    }
}

// Function to check document status and send notifications if necessary
async function processDocuments() {
    const collectionName = 'AlertTable';

    try {
        // Get all documents in the AlertTable collection
        const collectionRef = db.collection(collectionName);
        const snapshot = await collectionRef.get();

        // Process each document in AlertTable
        for (const doc of snapshot.docs) {
            const docData = doc.data();
            const returnTimestamp = docData.ReturnTimestamp?.toDate(); // Convert Firestore Timestamp to Date
            const isAlertSent = docData.isAlertSent;
            const isTripComplete=docData.IsTripCompleted;
            const userId = docData.UserId; // Get the UserId from the document

            if (!isAlertSent && returnTimestamp && !isTripComplete) {
                // Convert ReturnTimestamp to UTC format using Luxon
                const returnUTC = DateTime.fromJSDate(returnTimestamp, { zone: 'utc' });

                // Get the current UTC time
                const currentUTC = DateTime.utc();

                // Calculate the difference in minutes
                const diffInMinutes = currentUTC.diff(returnUTC, 'minutes').minutes;

                if (diffInMinutes > 1) {
                    writeLog(`Document ID ${doc.id} is late by ${diffInMinutes} minutes.`);

                    // Send notification and update the document
                    await sendNotificationAndUpdateDocuments(doc.id, userId);
                }
            }
        }

        return 'OK'; // Return a simple message indicating success
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Failed",
            "TimeOfCronLog": DateTime.now().toISO(),
            "Error": error.message
        });
        writeLog(`Error processing documents: ${error.message}`);
        return 'Error'; // Return a simple error message
    }
}

async function addCronJobLog() {
    try {

        writeLog(`CronJob Success at: ${DateTime.now().toISO()}`);
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Failed",
            "TimeOfCronLog": DateTime.now().toISO(),
            "Error": error.message
        });
        writeLog(`Error adding cron job log: ${error.message}`);
        throw error; // Re-throw to be caught by the calling function
    }
}

// Schedule the job to run every 15 minutes
const schedule = require('node-schedule');
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
        await addCronJobLog();
        return res.status(200).send('OK'); // Respond with a simple "OK" message
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Failed",
            "TimeOfCronLog": DateTime.now().toISO(),
            "Error": error.message
        });
        return res.status(500).send('Error'); // Respond with a simple "Error" message
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    writeLog(`Server is running on port ${PORT}`);
});
