const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon'); // Importing Luxon for date handling
const fs = require('fs'); // Import fs module to write logs to a file
const schedule = require('node-schedule'); // Import node-schedule

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
// Function to send a notification, update the document, and log emergency contacts
async function sendNotificationAndUpdateDocuments(alertTableId) {
    try {
        // Update the AlertTable document
        await db.collection('AlertTable').doc(alertTableId).update({
            AlertedTimestamp: new Date(),
            isAlertSent: true,
        });

        // Retrieve the emergency contacts from EmergencyContactTable using the document ID
        const emergencyContactsDoc = await db.collection('EmergencyContactTable').doc(alertTableId).get();

        if (emergencyContactsDoc.exists) {
            const emergencyContactsData = emergencyContactsDoc.data();

            // Log for EmergencyContact1
            if (emergencyContactsData.EmergencyContact1) {
                writeLog(`Notification sent to ${emergencyContactsData.EmergencyContact1}  for AlertTable ID: ${alertTableId}`);
            }

            // Log for EmergencyContact2
            if (emergencyContactsData.EmergencyContact2) {
                writeLog(`Notification sent to ${emergencyContactsData.EmergencyContact2.Name}  for AlertTable ID: ${alertTableId}`);
            }

            // If no contacts found
            if (!emergencyContactsData.EmergencyContact1 && !emergencyContactsData.EmergencyContact2) {
                writeLog(`No emergency contacts found for AlertTable ID: ${alertTableId}`);
            }
        } else {
            writeLog(`EmergencyContactTable document does not exist for AlertTable ID: ${alertTableId}`);
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

            if (!isAlertSent && returnTimestamp) {
                // Convert ReturnTimestamp to ISO format
                const returnISO = DateTime.fromJSDate(returnTimestamp).toISO();
                
                // Get the current time in ISO format
                const currentISO = DateTime.now().toISO();

                // Calculate the difference in minutes
                const diffInMinutes = DateTime.fromISO(currentISO).diff(DateTime.fromISO(returnISO), 'minutes').minutes;

                // Check if the difference is more than 60 minutes
                if (diffInMinutes > 60) {
                    writeLog(`Document ID ${doc.id} is late by ${diffInMinutes} minutes.`);

                    // Send notification and update the document
                    await sendNotificationAndUpdateDocuments(doc.id);
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
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Success",
            "TimeOfCronLog": DateTime.now().toISO()
        });

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
