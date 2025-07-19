/**
 * @fileoverview
 * This script uploads a single JavaScript bundle file to an SFTP server.
 * It uses environment variables for configuration, which is a security best practice.
 * It supports authentication via password or an SSH private key.
 *
 * Required Environment Variables:
 * - SFTP_HOST: The hostname or IP address of the SFTP server.
 * - SFTP_PORT: The port number for the SFTP server (defaults to 22).
 * - SFTP_USERNAME: The username for SFTP authentication.
 * - LOCAL_FILE_PATH: The local path to the JS bundle file to be uploaded.
 * - REMOTE_FILE_PATH: The destination path on the SFTP server.
 *
 * Authentication (provide one of the following):
 * - SFTP_PASSWORD: The password for SFTP authentication.
 * - SFTP_PRIVATE_KEY_PATH: The local path to the SSH private key file.
 *
 * To run this script:
 * 1. Install dependencies: `npm install typescript ts-node ssh2-sftp-client dotenv`
 * 2. Create a `.env` file in the root of your project with the variables above.
 * 3. Compile and run: `ts-node sftp-uploader.ts`
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import SftpClient, { ConnectOptions } from "ssh2-sftp-client";

// Load environment variables from .env file

// --- Environment Variables ---
const {
    SFTP_HOST,
    SFTP_PORT,
    SFTP_USERNAME,
    SFTP_PASSWORD,
    SFTP_PRIVATE_KEY_PATH,
    LOCAL_FILE_PATH,
    REMOTE_FILE_PATH
} = process.env;

/**
 * Validates that all required environment variables are set.
 * If any are missing, it throws an error.
 */
function validateConfig() {
    const requiredVars = [
        "SFTP_HOST",
        "SFTP_USERNAME",
        "LOCAL_FILE_PATH",
        "REMOTE_FILE_PATH"
    ];

    const missingVars = requiredVars.filter((v) => !process.env[v]);

    if (missingVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingVars.join(", ")}`
        );
    }

    // Validate that at least one authentication method is provided
    if (!SFTP_PASSWORD && !SFTP_PRIVATE_KEY_PATH) {
        throw new Error(
            "Authentication error: Please provide either SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH in your .env file."
        );
    }

    // Validate that the private key file exists if the path is provided
    if (SFTP_PRIVATE_KEY_PATH && !fs.existsSync(SFTP_PRIVATE_KEY_PATH)) {
        throw new Error(`Private key file not found at: ${SFTP_PRIVATE_KEY_PATH}`);
    }

    // Validate that the local file to upload exists
    if (!LOCAL_FILE_PATH || !fs.existsSync(LOCAL_FILE_PATH)) {
        throw new Error(`Local file not found at: ${LOCAL_FILE_PATH}`);
    }
}

/**
 * Main function to connect to the SFTP server and upload the file.
 */
async function uploadFile() {
    // 1. Validate configuration before proceeding
    try {
        validateConfig();
        console.log("✅ Configuration validated successfully.");
    } catch (error) {
        console.error("❌ Configuration error:", (error as Error).message);
        process.exit(1); // Exit with an error code
    }

    // 2. Build SFTP configuration object
    const sftpConfig: ConnectOptions = {
        host: SFTP_HOST,
        port: SFTP_PORT ? parseInt(SFTP_PORT, 10) : 22,
        username: SFTP_USERNAME
    };

    // 3. Set authentication method based on provided environment variables
    if (SFTP_PRIVATE_KEY_PATH) {
        sftpConfig.privateKey = fs.readFileSync(SFTP_PRIVATE_KEY_PATH);
        console.log("🔑 Using SSH private key for authentication.");
    } else {
        sftpConfig.password = SFTP_PASSWORD;
        console.log("🔒 Using password for authentication.");
    }

    const sftp = new SftpClient();

    try {
        // 4. Connect to the SFTP server
        console.log(`Connecting to ${sftpConfig.host}:${sftpConfig.port}...`);
        await sftp.connect(sftpConfig);
        console.log("🤝 Connection successful.");

        // 5. Ensure remote directory exists
        const remoteDir = path.dirname(REMOTE_FILE_PATH!);
        const dirExists = await sftp.exists(remoteDir);
        if (!dirExists) {
            console.log(`Creating remote directory: ${remoteDir}`);
            await sftp.mkdir(remoteDir, true); // `true` for recursive creation
        }

        // 6. Upload the file
        console.log(`Uploading ${LOCAL_FILE_PATH} to ${REMOTE_FILE_PATH}...`);
        await sftp.put(LOCAL_FILE_PATH!, REMOTE_FILE_PATH!);
        console.log("🚀 File uploaded successfully!");
    } catch (err) {
        // 7. Handle any errors during the process
        console.error("❌ An error occurred:", (err as Error).message);
    } finally {
        // 8. Always ensure the connection is closed
        if (sftp.sftp) {
            await sftp.end();
            console.log("🔌 Connection closed.");
        }
    }
}

// --- Execute the script ---
uploadFile();
