import { randomUUID } from 'crypto';
import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import {
  CreateRecordDto,
  ListQueryDto,
  SummaryQueryDto,
  UpdateRecordDto,
} from './organization-finance.schema';

const BUCKET_NAME = 'org-finance-receipts';

type ReceiptType = {
  extension: 'pdf' | 'jpg' | 'png';
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  extensions: string[];
};

type FilterOperations<T> = {
  category: (query: T, value: 'income' | 'expense') => T;
  dateFrom: (query: T, value: string) => T;
  dateTo: (query: T, value: string) => T;
  search: (query: T, value: string) => T;
  minAmount: (query: T, value: number) => T;
  maxAmount: (query: T, value: number) => T;
  hasDocument: (query: T, value: boolean) => T;
};

type RecordFilters = Pick<
  ListQueryDto,
  'category' | 'month' | 'date_from' | 'date_to' | 'search' |
  'min_amount' | 'max_amount' | 'has_document'
>;

function getMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);

  return { startDate: `${month}-01`, endDate };
}

function applyRecordFilters<T>(
  initialQuery: T,
  filters: RecordFilters,
  operations: FilterOperations<T>,
): T {
  let query = initialQuery;

  if (filters.category) query = operations.category(query, filters.category);

  if (filters.month) {
    const { startDate, endDate } = getMonthRange(filters.month);
    query = operations.dateFrom(query, startDate);
    query = operations.dateTo(query, endDate);
  } else {
    if (filters.date_from) query = operations.dateFrom(query, filters.date_from);
    if (filters.date_to) query = operations.dateTo(query, filters.date_to);
  }

  const safeSearch = filters.search?.replace(/[,()%_]/g, '').trim();
  if (safeSearch) query = operations.search(query, `%${safeSearch}%`);

  if (filters.min_amount !== undefined) {
    query = operations.minAmount(query, filters.min_amount);
  }
  if (filters.max_amount !== undefined) {
    query = operations.maxAmount(query, filters.max_amount);
  }
  if (filters.has_document !== undefined) {
    query = operations.hasDocument(query, filters.has_document);
  }

  return query;
}

function getReceiptType(file: Express.Multer.File): ReceiptType | undefined {
  const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
  const buffer = file.buffer;

  if (buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return extension === '.pdf'
      ? { extension: 'pdf', mimeType: 'application/pdf', extensions: ['.pdf'] }
      : undefined;
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return extension === '.png'
      ? { extension: 'png', mimeType: 'image/png', extensions: ['.png'] }
      : undefined;
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return ['.jpg', '.jpeg'].includes(extension)
      ? { extension: 'jpg', mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] }
      : undefined;
  }
  return undefined;
}

function getPeriodRpcArgs(filters: RecordFilters) {
  return {
    p_category: filters.category ?? null,
    p_month: filters.month ?? null,
    p_date_from: filters.date_from ?? null,
    p_date_to: filters.date_to ?? null,
    p_search: filters.search?.replace(/[,()%_]/g, '').trim() || null,
    p_min_amount: filters.min_amount ?? null,
    p_max_amount: filters.max_amount ?? null,
    p_has_document: filters.has_document ?? null,
  };
}

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
      .createSignedUrl(record.document_path, 3600);

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

  private static async formatSingleRecord(record: any) {
    const enriched = await this.enrichWithSignedUrl(record);
    const { profiles, amount, ...recordData } = enriched;

    return {
      ...recordData,
      amount: Number(amount).toFixed(2),
      created_by: profiles,
    };
  }

  /**
   * Create a new financial record (with optional file upload).
   */
  static async createRecord(dto: CreateRecordDto, file?: Express.Multer.File, userId?: string) {
    const recordId = randomUUID();
    let documentData = {};
    let uploadedPath: string | undefined;

    if (file) {
      const receiptType = getReceiptType(file);
      if (!receiptType) throw Errors.unsupportedMediaType();

      uploadedPath = `${recordId}/${Date.now()}.${receiptType.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(uploadedPath, file.buffer, {
          contentType: receiptType.mimeType,
          upsert: false,
        });

      if (uploadError) {
        throw Errors.internal(`Failed to upload receipt document: ${uploadError.message}`);
      }

      documentData = {
        document_path: uploadedPath,
        document_name: file.originalname,
        document_mime_type: receiptType.mimeType,
        document_size_bytes: file.size,
      };
    }

    let record: any;
    try {
      const { data, error } = await supabase
        .from('organization_financial_records')
        .insert([
          {
            id: recordId,
            ...dto,
            created_by: userId,
            ...documentData,
          },
        ])
        .select('*, profiles:created_by(id, name)')
        .single();

      if (error) throw Errors.badRequest(error.message);
      if (!data) throw Errors.internal('Failed to create financial record.');
      record = data;
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([uploadedPath]);

        if (cleanupError) {
          throw Errors.internal(
            `Record creation failed and receipt cleanup failed: ${cleanupError.message}`,
          );
        }
      }
      throw error;
    }

    return this.formatSingleRecord(record);
  }

  /**
   * Update a financial record and optionally replace or remove its receipt.
   */
  static async updateRecord(
    id: string,
    updates: Omit<UpdateRecordDto, 'document'>,
    file?: Express.Multer.File,
  ) {
    const { data: existing, error: lookupError } = await supabase
      .from('organization_financial_records')
      .select('document_path')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (lookupError) throw Errors.internal(lookupError.message);
    if (!existing) throw Errors.notFound('Financial record');

    const { remove_document: removeDocument, ...recordUpdates } = updates;
    let uploadedPath: string | undefined;
    let documentUpdates = {};

    if (file) {
      const receiptType = getReceiptType(file);
      if (!receiptType) throw Errors.unsupportedMediaType();

      uploadedPath = `${id}/${Date.now()}.${receiptType.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(uploadedPath, file.buffer, {
          contentType: receiptType.mimeType,
          upsert: false,
        });

      if (uploadError) {
        throw Errors.internal(`Failed to upload receipt document: ${uploadError.message}`);
      }

      documentUpdates = {
        document_path: uploadedPath,
        document_name: file.originalname,
        document_mime_type: receiptType.mimeType,
        document_size_bytes: file.size,
      };
    } else if (removeDocument) {
      documentUpdates = {
        document_path: null,
        document_name: null,
        document_mime_type: null,
        document_size_bytes: null,
      };
    }

    let updatedRecord: any;
    try {
      const { data, error } = await supabase
        .from('organization_financial_records')
        .update({
          ...recordUpdates,
          ...documentUpdates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .is('deleted_at', null)
        .select('*, profiles:created_by(id, name)')
        .single();

      if (error || !data) {
        if (error?.code === 'PGRST116') throw Errors.notFound('Financial record');
        throw Errors.badRequest(error?.message ?? 'Failed to update financial record.');
      }

      updatedRecord = data;
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([uploadedPath]);
        if (cleanupError) {
          throw Errors.internal(
            `Record update failed and new receipt cleanup failed: ${cleanupError.message}`,
          );
        }
      }
      throw error;
    }

    if ((file || removeDocument) && existing.document_path) {
      const { error: deleteError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([existing.document_path]);
      if (deleteError) {
        throw Errors.internal(`Failed to delete the replaced receipt: ${deleteError.message}`);
      }
    }

    return this.formatSingleRecord(updatedRecord);
  }

  /**
   * List records with filters, pagination, and period totals.
   */
  static async listRecords(query: ListQueryDto) {
    const { sort_by, sort_order, page, limit } = query;

    let recordsQuery = supabase
      .from('organization_financial_records')
      .select('id, amount, category, purpose, counterparty, transaction_date, created_at, document_path', { count: 'exact' })
      .is('deleted_at', null);

    recordsQuery = applyRecordFilters(recordsQuery, query, {
      category: (builder, value) => builder.eq('category', value),
      dateFrom: (builder, value) => builder.gte('transaction_date', value),
      dateTo: (builder, value) => builder.lte('transaction_date', value),
      search: (builder, value) => builder.or(`purpose.ilike.${value},counterparty.ilike.${value}`),
      minAmount: (builder, value) => builder.gte('amount', value),
      maxAmount: (builder, value) => builder.lte('amount', value),
      hasDocument: (builder, value) => value
        ? builder.not('document_path', 'is', null)
        : builder.is('document_path', null),
    });

    const offset = (page - 1) * limit;
    recordsQuery = recordsQuery
      .order(sort_by, { ascending: sort_order === 'asc' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await recordsQuery;
    if (error) throw Errors.internal(error.message);

    const { data: periodTotals, error: totalsError } = await supabase.rpc(
      'organization_finance_period_totals',
      getPeriodRpcArgs(query),
    );
    if (totalsError) throw Errors.internal(totalsError.message);

    const formattedData = (data ?? []).map((record) => ({
      id: record.id,
      amount: Number(record.amount).toFixed(2),
      category: record.category,
      purpose: record.purpose,
      counterparty: record.counterparty,
      transaction_date: record.transaction_date,
      created_at: record.created_at,
      has_document: Boolean(record.document_path),
    }));

    const totalRecords = count ?? 0;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    return {
      data: formattedData,
      meta: { total: totalRecords, page, limit, pages: totalPages },
      period_totals: periodTotals,
    };
  }

  /**
   * Get SQL-aggregated financial overview and trend data.
   */
  static async getSummary(query: SummaryQueryDto) {
    const { data, error } = await supabase.rpc('organization_finance_summary', {
      p_month: query.month ?? null,
      p_date_from: query.date_from ?? null,
      p_date_to: query.date_to ?? null,
      p_months: query.months,
    });
    if (error) throw Errors.internal(error.message);
    return data;
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
      throw Errors.notFound('Financial record');
    }

    return this.formatSingleRecord(data);
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
      throw Errors.notFound('Financial record');
    }

    return true;
  }
}
