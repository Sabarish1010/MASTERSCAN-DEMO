## 1. Google Apps Script Setup

1. Go to your [Google Apps Script Project](https://script.google.com/home/projects/12aEMEe8mkujUF1BPSB5IcU3oELDxEkhKO8dYhde81Kwxw_IDc6BPvqlh/edit).
2. Create a script file named `Code.gs` and copy the contents of the local `Code.gs`.
3. Create an HTML file named `index.html` and copy the contents of the local `index.html`.
4. Update `TEMPLATE_DOC_ID` in `Code.gs` (line 7) with your Google Doc template ID.
5. Click **Deploy** > **New Deployment**.
6. Select Type: **Web App**.
7. Set **Execute As**: `Me`.
8. Set **Who has access**: `Anyone` (required for field access).
9. Copy the **Web App URL** to access your new reporting system.

## 3. Usage

1. Open `index.html` in any browser (Chrome recommended).
2. **Home Screen**: Select a department, type the client name (autocomplete works based on existing folders in Drive), and pick a date.
3. **Step 1 (Details)**: Fill in the department-specific metadata.
4. **Step 2 (Data Table)**: Enter inspection points manually or upload an Excel file.
5. **Step 3 (Images)**: Upload photos and add captions. Customize the grid layout (e.g., 2x3 or 1x4).
6. **Step 4 (Signatures)**: Draw signatures or upload signature images.
7. **Preview**: Verify all pages before saving.
8. **Save**: Click "Save to Drive" to automatically create the folder hierarchy, generate the Google Doc, and log data to Google Sheets.

## Features

- **Offline Drafts**: Automatically saves progress to `localStorage`. You can resume if the browser refreshes.
- **Mobile First**: Designed for tablets and phones used in the field.
- **Branding**: Uses Masterscan's Navy/Gold/Red color scheme with industrial typography.
- **Auto-Calculations**: Automatically formats dates and maps fields to templates.

## Folder Hierarchy Created

- `My Drive/Masterscan Reporting/`
    - `[DEPT]/` (e.g., PT, UTG)
        - `[CLIENT NAME]/`
            - `[DD.MM.YYYY]/`
                - `Report_Doc`
                - `Data_Sheet`
                - `Images/`
