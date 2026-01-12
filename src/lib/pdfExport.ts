/**
 * PDF Export Utility
 * 
 * This module provides functions to export transaction and group data to PDF format.
 * Uses jsPDF library for PDF generation.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

// Type extension for jsPDF with autoTable
interface jsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number;
  };
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  reference: string;
  payment_method: string;
  created_at: string;
  group_id?: string;
  metadata?: any;
}

interface GroupData {
  name: string;
  description?: string;
  contribution_amount: number;
  frequency: string;
  total_members: number;
  current_members: number;
  current_cycle: number;
  total_cycles: number;
  status: string;
}

interface MemberData {
  full_name: string;
  email: string;
  position: number;
  has_paid_security_deposit: boolean;
  status: string;
}

interface ContributionData {
  user_name: string;
  cycle_number: number;
  amount: number;
  status: string;
  due_date: string;
  paid_date?: string;
}

/**
 * Export transactions to PDF
 */
export function exportTransactionsToPDF(
  transactions: Transaction[],
  userName: string,
  userEmail: string
): void {
  const doc = new jsPDF();

  // Add title
  doc.setFontSize(20);
  doc.text('Transaction History', 14, 20);

  // Add user info
  doc.setFontSize(10);
  doc.text(`Name: ${userName}`, 14, 30);
  doc.text(`Email: ${userEmail}`, 14, 35);
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 14, 40);

  // Add transactions table
  const tableData = transactions.map(tx => [
    format(new Date(tx.created_at), 'MMM dd, yyyy'),
    tx.reference,
    tx.type.replace('_', ' ').toUpperCase(),
    tx.payment_method.replace('_', ' '),
    `₦${tx.amount.toLocaleString()}`,
    tx.status.toUpperCase(),
  ]);

  autoTable(doc, {
    startY: 50,
    head: [['Date', 'Reference', 'Type', 'Method', 'Amount', 'Status']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 125, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    margin: { top: 50 },
  });

  // Add summary
  const totalAmount = transactions
    .filter(tx => tx.status === 'completed')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const finalY = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || 50;
  doc.setFontSize(12);
  doc.text(`Total Transactions: ${transactions.length}`, 14, finalY + 10);
  doc.text(`Total Amount: ₦${totalAmount.toLocaleString()}`, 14, finalY + 17);

  // Add footer
  doc.setFontSize(8);
  doc.text(
    `Smart Ajo - Secure Savings Made Easy`,
    doc.internal.pageSize.getWidth() / 2,
    doc.internal.pageSize.getHeight() - 10,
    { align: 'center' }
  );

  // Save the PDF
  doc.save(`transactions_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

/**
 * Export group report to PDF
 */
export function exportGroupReportToPDF(
  group: GroupData,
  members: MemberData[],
  contributions: ContributionData[],
  penalties: any[]
): void {
  const doc = new jsPDF();

  // Add title
  doc.setFontSize(20);
  doc.text('Group Report', 14, 20);

  // Add group info
  doc.setFontSize(14);
  doc.text(group.name, 14, 30);
  
  doc.setFontSize(10);
  doc.text(`Status: ${group.status.toUpperCase()}`, 14, 38);
  doc.text(`Cycle: ${group.current_cycle} of ${group.total_cycles}`, 14, 43);
  doc.text(`Members: ${group.current_members} of ${group.total_members}`, 14, 48);
  doc.text(`Contribution: ₦${group.contribution_amount.toLocaleString()} (${group.frequency})`, 14, 53);
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 14, 58);

  let currentY = 68;

  // Members section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Members', 14, currentY);
  currentY += 5;

  const membersData = members.map(m => [
    m.full_name,
    m.email,
    m.position.toString(),
    m.has_paid_security_deposit ? 'Paid' : 'Pending',
    m.status,
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Name', 'Email', 'Position', 'Security Deposit', 'Status']],
    body: membersData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 125, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    styles: {
      fontSize: 9,
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  // Contributions section
  if (contributions.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Contributions (Cycle ${group.current_cycle})`, 14, currentY);
    currentY += 5;

    const contributionsData = contributions.map(c => [
      c.user_name,
      `₦${c.amount.toLocaleString()}`,
      c.status,
      format(new Date(c.due_date), 'MMM dd, yyyy'),
      c.paid_date ? format(new Date(c.paid_date), 'MMM dd, yyyy') : 'N/A',
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [['Name', 'Amount', 'Status', 'Due Date', 'Paid Date']],
      body: contributionsData,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 125, 110],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      styles: {
        fontSize: 9,
      },
    });

    currentY = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || currentY + 10;
  }

  // Penalties section
  if (penalties.length > 0) {
    // Check if we need a new page
    if (currentY > 250) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Penalties', 14, currentY);
    currentY += 5;

    const penaltiesData = penalties.map(p => [
      p.user_name,
      `₦${p.amount.toLocaleString()}`,
      p.type.replace('_', ' '),
      p.status,
      format(new Date(p.created_at), 'MMM dd, yyyy'),
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [['Name', 'Amount', 'Type', 'Status', 'Date']],
      body: penaltiesData,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 125, 110],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      styles: {
        fontSize: 9,
      },
    });
  }

  // Add footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `Smart Ajo - Secure Savings Made Easy | Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save the PDF
  doc.save(`${group.name.replace(/\s+/g, '_')}_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

/**
 * Export single group transaction history to PDF
 */
export function exportGroupTransactionsToPDF(
  groupName: string,
  transactions: Transaction[]
): void {
  const doc = new jsPDF();

  // Add title
  doc.setFontSize(20);
  doc.text('Group Transaction History', 14, 20);

  // Add group info
  doc.setFontSize(12);
  doc.text(groupName, 14, 30);
  doc.setFontSize(10);
  doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 14, 37);

  // Add transactions table
  const tableData = transactions.map(tx => [
    format(new Date(tx.created_at), 'MMM dd, yyyy'),
    tx.reference,
    tx.type.replace('_', ' ').toUpperCase(),
    `₦${tx.amount.toLocaleString()}`,
    tx.status.toUpperCase(),
  ]);

  autoTable(doc, {
    startY: 45,
    head: [['Date', 'Reference', 'Type', 'Amount', 'Status']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 125, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
  });

  // Add summary
  const totalAmount = transactions
    .filter(tx => tx.status === 'completed')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const finalY = (doc as jsPDFWithAutoTable).lastAutoTable?.finalY || 45;
  doc.setFontSize(12);
  doc.text(`Total Transactions: ${transactions.length}`, 14, finalY + 10);
  doc.text(`Total Amount: ₦${totalAmount.toLocaleString()}`, 14, finalY + 17);

  // Add footer
  doc.setFontSize(8);
  doc.text(
    `Smart Ajo - Secure Savings Made Easy`,
    doc.internal.pageSize.getWidth() / 2,
    doc.internal.pageSize.getHeight() - 10,
    { align: 'center' }
  );

  // Save the PDF
  doc.save(`${groupName.replace(/\s+/g, '_')}_transactions_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}
