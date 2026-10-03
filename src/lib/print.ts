export function printInvoice(elementId: string, title = 'Invoice', type: 'thermal' | 'a4' = 'thermal') {
  const originalTitle = document.title;
  document.title = title;

  const targetEl = document.getElementById(elementId);
  if (!targetEl) {
    console.warn(`Print target element #${elementId} not found`);
  }

  // Remove any previously orphaned print style elements
  const oldStyle = document.getElementById('print-page-style');
  if (oldStyle && oldStyle.parentNode) {
    oldStyle.parentNode.removeChild(oldStyle);
  }

  // Mark body with active printing class
  document.body.classList.add('is-printing-target');

  const styleEl = document.createElement('style');
  styleEl.id = 'print-page-style';
  document.head.appendChild(styleEl);

  if (type === 'thermal') {
    styleEl.innerHTML = `
      @media print { 
        @page { 
          size: 80mm auto; 
          margin: 0; 
        }
        html, body { 
          width: 80mm !important; 
          min-width: 80mm !important;
          max-width: 80mm !important;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important; 
          padding: 0 !important; 
          background: #ffffff !important;
          color: #000000 !important;
          overflow: visible !important;
          position: static !important;
        }
        #root, main, .layout {
          display: block !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          position: static !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
        }
        /* Hide all UI elements, navigation, buttons */
        header, aside, nav, footer, button, input, select,
        .print\\:hidden, [class*="print:hidden"], .no-print {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        /* Target element must be static in normal flow without blank pages */
        #${elementId} {
          position: static !important;
          width: 78mm !important;
          max-width: 78mm !important;
          display: block !important;
          margin: 0 auto !important;
          padding: 2mm !important;
          overflow: visible !important;
          background: #ffffff !important;
          color: #000000 !important;
          page-break-inside: auto !important;
        }
        #${elementId}, #${elementId} * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color: #000000 !important;
          -webkit-text-fill-color: #000000 !important;
          border-color: #000000 !important;
        }
      }
    `;
  } else {
    // A4 Multi-page Reports and Invoices
    styleEl.innerHTML = `
      @media print { 
        @page { 
          size: A4 portrait; 
          margin: 10mm 8mm 12mm 8mm; 
        }
        html, body { 
          width: 100% !important; 
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important; 
          padding: 0 !important; 
          background: #ffffff !important;
          color: #000000 !important;
          overflow: visible !important;
          position: static !important;
          font-size: 11px !important;
        }
        #root, main, .layout, div[class*="overflow"], div[class*="flex-1"] {
          display: block !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          position: static !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
        }
        /* Strictly hide UI controls, nav, header, sidebar, buttons */
        header, aside, nav, footer, button, input, select,
        .print\\:hidden, [class*="print:hidden"], .no-print {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        /* Target element: STATIC normal flow across pages, no blank pages */
        #${elementId} {
          position: static !important;
          width: 100% !important;
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          background: #ffffff !important;
          color: #000000 !important;
          page-break-inside: auto !important;
        }
        #${elementId}, #${elementId} * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color: #000000 !important;
          -webkit-text-fill-color: #000000 !important;
          border-color: #000000 !important;
        }
        /* Keep tables repeating headers and breaking cleanly without orphan blank pages */
        table {
          page-break-inside: auto !important;
          border-collapse: collapse !important;
          width: 100% !important;
        }
        thead {
          display: table-header-group !important;
        }
        tfoot {
          display: table-footer-group !important;
        }
        tr {
          page-break-inside: avoid !important;
          page-break-after: auto !important;
        }
        td, th {
          page-break-inside: avoid !important;
        }
      }
    `;
  }

  const cleanup = () => {
    document.title = originalTitle;
    document.body.classList.remove('is-printing-target');
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
  };

  window.addEventListener('afterprint', cleanup, { once: true });

  // Delay to ensure title and styles are applied before the print dialog grabs it
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 2000);
  }, 150);
}
