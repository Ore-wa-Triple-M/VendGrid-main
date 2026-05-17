// assets/js/xlsx-export.js
// Shared Excel export utility using ExcelJS

async function exportToExcel(workbookName, sheets) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VendGrid';
    workbook.created = new Date();

    for (const sheet of sheets) {
        const worksheet = workbook.addWorksheet(sheet.name);

        const colCount = sheet.columns.length;
        const lastCol  = String.fromCharCode(64 + colCount); // e.g. 'F' for 6 columns

        // ----- HEADER SECTION (merged cells, dynamic width) -----
        worksheet.mergeCells(`A1:${lastCol}1`);
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'VendGrid – ' + sheet.title;
        titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 30;

        worksheet.mergeCells(`A2:${lastCol}2`);
        const dateCell = worksheet.getCell('A2');
        dateCell.value = `Generated: ${new Date().toLocaleString()}`;
        dateCell.font = { italic: true, size: 10 };
        dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECF0F1' } };
        dateCell.alignment = { horizontal: 'center' };

        let dataStartRow = 4; // row where table header lives (1-based)

        // Optional: user info row
        if (typeof currentUser !== 'undefined' && currentUser?.email) {
            worksheet.mergeCells(`A3:${lastCol}3`);
            const userCell = worksheet.getCell('A3');
            userCell.value = `Exported by: ${currentUser.email}`;
            userCell.font = { italic: true, size: 10 };
            userCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECF0F1' } };
            userCell.alignment = { horizontal: 'center' };
            dataStartRow = 5;
        }

        // ----- TABLE HEADER ROW -----
        const headerRow = worksheet.addRow(sheet.columns.map(col => col.label));
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '34495E' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 20;
        headerRow.eachCell(cell => {
            cell.border = {
                top: { style: 'thin' }, bottom: { style: 'thin' },
                left: { style: 'thin' }, right: { style: 'thin' }
            };
        });

        // ----- DATA ROWS (zebra striping) -----
        sheet.data.forEach((rowData, rowIdx) => {
            // Build the cell values using the column index — safe, no reliance on cell.col
            const values = sheet.columns.map((col, colIdx) => {
                let value = rowData[col.key];
                if (col.transform) value = col.transform(value, rowData);
                if (col.format === 'currency') value = parseFloat(value) || 0;
                return value ?? '—';
            });

            const dataRow = worksheet.addRow(values);
            const fillColor = rowIdx % 2 === 0 ? 'F8F9FA' : 'FFFFFF';

            // Apply style to each cell using colIdx — guaranteed to match sheet.columns
            sheet.columns.forEach((col, colIdx) => {
                const cell = dataRow.getCell(colIdx + 1); // getCell is 1-based

                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                cell.border = {
                    top: { style: 'thin' }, bottom: { style: 'thin' },
                    left: { style: 'thin' }, right: { style: 'thin' }
                };

                // Alignment
                const align = col.align || 'left';
                cell.alignment = { horizontal: align, vertical: 'middle', wrapText: false };

                // Currency number format
                if (col.format === 'currency') {
                    cell.numFmt = '"KES "#,##0.00';
                    cell.value  = parseFloat(cell.value) || 0;
                }
            });
        });

        // ----- AUTO COLUMN WIDTH -----
        sheet.columns.forEach((col, colIdx) => {
            let maxLen = col.label.length;
            worksheet.getColumn(colIdx + 1).eachCell({ includeEmpty: true }, cell => {
                const len = cell.value != null ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = Math.min(len, 50);
            });
            worksheet.getColumn(colIdx + 1).width = maxLen + 4;
        });
    }

    // ----- TRIGGER DOWNLOAD -----
    const buffer = await workbook.xlsx.writeBuffer();
    const blob   = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${workbookName}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
}