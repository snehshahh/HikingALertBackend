const express = require('express');
const admin = require('firebase-admin');
const { DateTime } = require('luxon'); // Importing Luxon for date handling
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require('./hikingalert-260bf-firebase-adminsdk-8rkbb-24973cba1e.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();

// Function to send a notification and update documents
async function sendNotificationAndUpdateDocuments(alertTableId, alertStatusID) {
    try {
        await db.collection('AlertTable').doc(alertTableId).update({
            AlertedTimestamp: new Date(),
        });

        await db.collection('AlertStatusTable').doc(alertStatusID).update({
            Status: "Alerted",
        });

        console.log(`Notification sent and documents updated for AlertTable ID: ${alertTableId} and AlertStatus ID: ${alertStatusID}`);
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs":"Failed",
            "TimeOfCronLog":DateTime.now().toISO(),
            "Error":error
        });
        console.error(`Error updating documents ${alertTableId} and ${alertStatusID}:`, error);
        throw error; // Re-throw to be caught by the calling function
    }
}

// Function to check document status and send notifications if necessary
async function processDocuments() {
    const collectionName = 'AlertTable';
    const relatedCollectionName = 'AlertStatusTable';
    const results = [];

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
                    console.log(`Document ID ${doc.id} is late by ${diffInMinutes} minutes.`);

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
                                results.push({
                                    alertTableId: doc.id,
                                    alertStatusID: relatedDoc.id,
                                    message: `Alert processed for document ID: ${doc.id}`,
                                });
                            }
                        } else {
                            console.log(`Related document with ID ${alertStatusID} does not exist.`);
                        }
                    } else {
                        console.log('No alertStatusID provided.');
                    }
                }
            }
        }

        return results;
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs":"Failed",
            "TimeOfCronLog":DateTime.now().toISO(),
            "Error":error
        });
        console.error('Error processing documents:', error);
        throw error; // Re-throw to be caught by the calling function
    }
}

async function addCronJobLog() {
    try {
        await db.collection('CronJobLogs').add({
            "CronJobLogs":"Success",
            "TimeOfCronLog":DateTime.now().toISO()
        });

        console.log(`CronJob Success at : ${DateTime.now().toISO()} and AlertStatus ID: ${DateTime.now().toISO()}`);
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs":"Failed",
            "TimeOfCronLog":DateTime.now().toISO(),
            "Error":error
        });
        throw error; // Re-throw to be caught by the calling function
    }
}

app.get('/', async (req, res) => {
    try {
        const results = await processDocuments();
        const cronJobLogResult  = await addCronJobLog();
        return res.status(200).json({
            message: 'CronJob Successful',
            time: DateTime.now().toISO(),
            processedAlerts: results,
        });
    } catch (error) {
        await db.collection('CronJobLogs').add({
            "CronJobLogs":"Failed",
            "TimeOfCronLog":DateTime.now().toISO(),
            "Error":error
        });
        return res.status(500).json({ error: 'An error occurred while processing alerts.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
