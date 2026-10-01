import { useRef } from 'react';
import { Printer } from 'lucide-react';

export function usePrint() {
  const printRef = useRef(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QualChek — Report</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 32px; }
            h1 { font-size: 22px; font-weight: 700; color: #1e3a8a; margin-bottom: 4px; }
            h2 { font-size: 15px; font-weight: 600; color: #1d4ed8; margin: 20px 0 8px; border-bottom: 2px solid #dbeafe; padding-bottom: 4px; }
            h3 { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
            .meta { font-size: 11px; color: #6b7280; margin-bottom: 24px; }
            .logo-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
            .logo-box { width: 36px; height: 36px; background: #2563eb; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px; }
            .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
            .kpi { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; text-align: center; }
            .kpi .value { font-size: 28px; font-weight: 700; color: #1d4ed8; }
            .kpi .label { font-size: 10px; color: #6b7280; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
            th { background: #1d4ed8; color: white; padding: 7px 10px; text-align: left; font-weight: 600; }
            td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
            tr:nth-child(even) td { background: #f9fafb; }
            .badge { display: inline-block; padding: 2px 7px; border-radius: 12px; font-size: 10px; font-weight: 600; text-transform: capitalize; }
            .badge-passed  { background: #dcfce7; color: #166534; }
            .badge-failed  { background: #fee2e2; color: #991b1b; }
            .badge-blocked { background: #ffedd5; color: #9a3412; }
            .badge-pending { background: #dbeafe; color: #1e40af; }
            .badge-skipped { background: #f3f4f6; color: #374151; }
            .badge-critical{ background: #fee2e2; color: #991b1b; }
            .badge-high    { background: #ffedd5; color: #9a3412; }
            .badge-medium  { background: #fef9c3; color: #854d0e; }
            .badge-low     { background: #dcfce7; color: #166534; }
            .progress-bar { width: 100%; background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden; display: flex; }
            .bar-pass  { background: #22c55e; height: 100%; }
            .bar-fail  { background: #ef4444; height: 100%; }
            .bar-block { background: #f97316; height: 100%; }
            .summary-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
            .summary-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 14px; }
            .summary-item .s-val { font-size: 18px; font-weight: 700; }
            .summary-item .s-lbl { font-size: 10px; color: #6b7280; text-transform: uppercase; }
            .green { color: #16a34a; } .red { color: #dc2626; } .orange { color: #ea580c; } .blue { color: #2563eb; }
            .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
            @media print {
              body { padding: 16px; }
              .no-print { display: none !important; }
              @page { margin: 1cm; size: A4; }
            }
          </style>
        </head>
        <body>${content.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 400);
  };

  return { printRef, handlePrint };
}

export function PrintButton({ onClick, label = 'Print Report', size = 'md' }) {
  return (
    <button onClick={onClick} className="btn-secondary">
      <Printer className="w-4 h-4" />
      {label}
    </button>
  );
}
