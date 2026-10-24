import { randomUUID } from 'crypto';
import { supabase } from '../../config/supabase';
import { AppError } from '../../shared/errors';
import { CreateRecordDto, UpdateRecordDto, ListQueryDto } from './organization-finance.schema';

const BUCKET_NAME = 'org-finance-receipts';

export class OrganizationFinanceService {
  /**
   * Helper to generate a signed URL for a receipt document if it exists.
   */
  private static async enrichWithSignedUrl(record: any) {
    if (!record.document_path) {
      return { ...record, document: null };
    }

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(record.document_path, 3600); // Expires in 1 hour

    const documentInfo = {
      name: record.document_name,
      mime_type: record.document_mime_type,
      size_bytes: record.document_size_bytes,
      url: error ? null : data?.signedUrl,
      url_expires_at: error ? null : new Date(Date.now() + 3600 * 1000).toISOString(),
    };

    const { document_path, document_name, document_mime_type, document_size_bytes, ...cleanedRecord } = record;
    return { ...cleanedRecord, document: documentInfo };
  }

  /**
   * Create a new financial record (with optional file upload).
   */
  static async createRecord(dto: CreateRecordDto, file?: Express.Multer.File, userId?: string) {
    let documentData = {};

    if (file) {
      const fileExt = file.originalname.split('.').pop() || 'bin';
      const timestamp = Date.now();
      const tempId = randomUUID();
      const documentPath = `${tempId}/${timestamp}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(documentPath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        throw new AppError('Failed to upload receipt document.', 500);
      }

      documentData = {
        document_path: documentPath,
        document_name: file.originalname,
        document_mime_type: file.mimetype,
        document_size_bytes: file.size,
      };
    }

    const { data, error } = await supabase
      .from('organization_financial_records')
      .insert([
        {
          ...dto,
          created_by: userId,
          ...documentData,
        },
      ])
      .select('*, profiles:created_by(id, name)')
      .single();

    if (error) {
      throw new AppError(error.message, 400);
    }

    return this.enrichWithSignedUrl(data);
  }

  /**
   * List records with filters, pagination, and period totals.
   */
  static async listRecords(query: ListQueryDto) {
    const { category, month, date_from, date_to, search, min_amount, max_amount, has_document, sort_by, sort_order, page, limit } = query;

    let dbQuery = supabase
      .from('organization_financial_records')
      .select('id, amount, category, purpose, counterparty, transaction_date, created_at, document_path, document_name, document_mime_type, document_size_bytes', { count: 'exact' })
      .is('deleted_at', null);

    // Apply filters
    if (category) dbQuery = dbQuery.eq('category', category);
    if (month) {
      const startDate = `${month}-01`;
      const [year, m] = month.split('-').map(Number);
      const endDate = new Date(year, m, 0).toISOString().split('T')[0];
      dbQuery = dbQuery.gte('transaction_date', startDate).lte('transaction_date', endDate);
    }
    if (date_from) dbQuery = dbQuery.gte('transaction_date', date_from);
    if (date_to) dbQuery = dbQuery.lte('transaction_date', date_to);
    if (search) dbQuery = dbQuery.or(`purpose.ilike.%${search}%,counterparty.ilike.%${search}%`);
    if (min_amount !== undefined) dbQuery = dbQuery.gte('amount', min_amount);
    if (max_amount !== undefined) dbQuery = dbQuery.lte('amount', max_amount);
    if (has_document === true) dbQuery = dbQuery.not('document_path', 'is', null);
    if (has_document === false) dbQuery = dbQuery.is('document_path', null);

    // Sorting & Pagination
    const offset = (page - 1) * limit;
    dbQuery = dbQuery.order(sort_by, { ascending: sort_order === 'asc' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await dbQuery;
    if (error) throw new AppError(error.message, 400);

    // Calculate Period Totals across all matching records (ignoring pagination)
    let totalsQuery = supabase
      .from('organization_financial_records')
      .select('amount, category')
      .is('deleted_at', null);

    if (category) totalsQuery = totalsQuery.eq('category', category);
    if (month) {
      const [year, m] = month.split('-').map(Number);
      const endDate = new Date(year, m, 0).toISOString().split('T')[0];
      totalsQuery = totalsQuery.gte('transaction_date', `${month}-01`).lte('transaction_date', endDate);
    }
    if (date_from) totalsQuery = totalsQuery.gte('transaction_date', date_from);
    if (date_to) totalsQuery = totalsQuery.lte('transaction_date', date_to);

    const { data: allMatching } = await totalsQuery;

    let totalIncome = 0;
    let totalExpenses = 0;

    allMatching?.forEach((row) => {
      const amt = Number(row.amount);
      if (row.category === 'income') totalIncome += amt;
      if (row.category === 'expense') totalExpenses += amt;
    });

    const formattedData = await Promise.all(
      (data || []).map(async (record) => {
        const enriched = await this.enrichWithSignedUrl(record);
        return {
          id: enriched.id,
          amount: enriched.amount,
          category: enriched.category,
          purpose: enriched.purpose,
          counterparty: enriched.counterparty,
          transaction_date: enriched.transaction_date,
          created_at: enriched.created_at,
          has_document: !!enriched.document_path,
        };
      })
    );

    const totalRecords = count || 0;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    return {
      data: formattedData,
      meta: { total: totalRecords, page, limit, pages: totalPages },
      period_totals: {
        total_income: totalIncome.toFixed(2),
        total_expenses: totalExpenses.toFixed(2),
        net_balance: (totalIncome - totalExpenses).toFixed(2),
      },
    };
  }

  /**
   * Get a single record by ID.
   */
  static async getRecordById(id: string) {
    const { data, error } = await supabase
      .from('organization_financial_records')
      .select('*, profiles:created_by(id, name)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new AppError('Financial record not found.', 404);
    }

    return this.enrichWithSignedUrl(data);
  }

  /**
   * Soft delete a record.
   */
  static async deleteRecord(id: string) {
    const { data, error } = await supabase
      .from('organization_financial_records')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error || !data) {
      throw new AppError('Financial record not found or already deleted.', 404);
    }

    return true;
  }
}