const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon'); // Importing Luxon for date handling
const fs = require('fs'); // Import fs module to write logs to a file
const path = require('path');

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

// Function to send a notification and update documents
async function sendNotificationAndUpdateDocuments(alertTableId, alertStatusID) {
    try {
        await db.collection('AlertTable').doc(alertTableId).update({
            AlertedTimestamp: new Date(),
        });

        await db.collection('AlertStatusTable').doc(alertStatusID).update({
            Status: "Alerted",
        });

        writeLog(`Notification sent and documents updated for AlertTable ID: ${alertTableId} and AlertStatus ID: ${alertStatusID}`);
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs": "Failed",
            "TimeOfCronLog": DateTime.now().toISO(),
            "Error": error.message // Log the error message
        });
        writeLog(`Error updating documents ${alertTableId} and ${alertStatusID}: ${error.message}`);
        throw error; // Re-throw to be caught by the calling function
    }
}

// Function to check document status and send notifications if necessary
async function processDocuments() {
    const collectionName = 'AlertTable';
    const relatedCollectionName = 'AlertStatusTable';

    try {
        // Get all documents in the AlertTable collection
        const collectionRef = db.collection(collectionName);
        const snapshot = await collectionRef.get();

        // Get the current time using Luxon for better readability
        const currentTime = DateTime.now();

        for (const doc of snapshot.docs) {
            const docData = doc.data();
            const timestamp = docData.ReturnTimestamp?.toDate(); // Convert Firestore Timestamp to Date
            const returnDate = docData.ReturnDate?.toDate(); // Convert Firestore Timestamp to Date

            if (timestamp) {
                // Calculate the difference in minutes using Luxon
                const diffInMinutes = currentTime.diff(DateTime.fromJSDate(timestamp), 'minutes').minutes;

                // Check if the timestamp is more than 60 minutes old
                if (diffInMinutes > 60) {
                    writeLog(`Document ID ${doc.id} is late by ${diffInMinutes} minutes.`);

                    // Fetch related document using alertStatusID
                    const alertStatusID = docData.AlertStatusID; // Assuming alertStatusID is the field name

                    if (alertStatusID) {
                        // Fetch the document from AlertStatusTable
                        const relatedDoc = await db.collection(relatedCollectionName).doc(alertStatusID).get();

                        if (relatedDoc.exists) {
                            const relatedData = relatedDoc.data();

                            // Check if ReturnDate is present and after the current time
                            if (relatedData.Status === "Pending" && returnDate && returnDate > currentTime.toJSDate()) {
                                await sendNotificationAndUpdateDocuments(doc.id, relatedDoc.id);
                            }
                        } else {
                            writeLog(`Related document with ID ${alertStatusID} does not exist.`);
                        }
                    } else {
                        writeLog('No alertStatusID provided.');
                    }
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
