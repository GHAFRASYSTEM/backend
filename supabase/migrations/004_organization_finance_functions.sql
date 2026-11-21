CREATE INDEX IF NOT EXISTS idx_org_financial_records_active_transaction_date
  ON public.organization_financial_records (transaction_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_financial_records_active_category_date
  ON public.organization_financial_records (category, transaction_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_financial_records_active_created_at
  ON public.organization_financial_records (created_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.organization_finance_period_totals(
  p_category text DEFAULT NULL,
  p_month text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_has_document boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH date_bounds AS (
    SELECT
      CASE WHEN p_month IS NOT NULL THEN (p_month || '-01')::date ELSE p_date_from END AS start_date,
      CASE
        WHEN p_month IS NOT NULL
          THEN (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date
        ELSE p_date_to
      END AS end_date
  ),
  totals AS (
    SELECT
      COALESCE(SUM(r.amount) FILTER (WHERE r.category::text = 'income'), 0)::numeric AS total_income,
      COALESCE(SUM(r.amount) FILTER (WHERE r.category::text = 'expense'), 0)::numeric AS total_expenses
    FROM public.organization_financial_records AS r
    CROSS JOIN date_bounds AS bounds
    WHERE r.deleted_at IS NULL
      AND (p_category IS NULL OR r.category::text = p_category)
      AND (bounds.start_date IS NULL OR r.transaction_date >= bounds.start_date)
      AND (bounds.end_date IS NULL OR r.transaction_date <= bounds.end_date)
      AND (
        p_search IS NULL
        OR r.purpose ILIKE '%' || p_search || '%'
        OR r.counterparty ILIKE '%' || p_search || '%'
      )
      AND (p_min_amount IS NULL OR r.amount >= p_min_amount)
      AND (p_max_amount IS NULL OR r.amount <= p_max_amount)
      AND (
        p_has_document IS NULL
        OR (p_has_document AND r.document_path IS NOT NULL)
        OR (NOT p_has_document AND r.document_path IS NULL)
      )
  )
  SELECT jsonb_build_object(
    'total_income', to_char(total_income, 'FM999999999999999999999999999999990.00'),
    'total_expenses', to_char(total_expenses, 'FM999999999999999999999999999999990.00'),
    'net_balance', to_char(total_income - total_expenses, 'FM999999999999999999999999999999990.00')
  )
  FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.organization_finance_summary(
  p_month text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_months integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_start date;
  v_period_end date;
  v_has_period boolean := p_month IS NOT NULL OR p_date_from IS NOT NULL OR p_date_to IS NOT NULL;
  v_period jsonb;
  v_all_income numeric;
  v_all_expenses numeric;
  v_period_income numeric;
  v_period_expenses numeric;
  v_income_count bigint;
  v_expense_count bigint;
  v_breakdown jsonb;
  v_trend jsonb;
  v_recent_records jsonb;
  v_months integer := LEAST(GREATEST(COALESCE(p_months, 6), 1), 24);
BEGIN
  IF p_month IS NOT NULL THEN
    v_period_start := (p_month || '-01')::date;
    v_period_end := (date_trunc('month', v_period_start) + interval '1 month - 1 day')::date;
  ELSE
    v_period_start := p_date_from;
    v_period_end := p_date_to;
  END IF;

  v_period := jsonb_build_object(
    'month', p_month,
    'date_from', CASE WHEN p_month IS NULL THEN p_date_from::text ELSE NULL END,
    'date_to', CASE WHEN p_month IS NULL THEN p_date_to::text ELSE NULL END
  );

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE category::text = 'income'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category::text = 'expense'), 0)
  INTO v_all_income, v_all_expenses
  FROM public.organization_financial_records
  WHERE deleted_at IS NULL;

  IF v_has_period THEN
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE category::text = 'income'), 0),
      COALESCE(SUM(amount) FILTER (WHERE category::text = 'expense'), 0),
      COUNT(*) FILTER (WHERE category::text = 'income'),
      COUNT(*) FILTER (WHERE category::text = 'expense')
    INTO v_period_income, v_period_expenses, v_income_count, v_expense_count
    FROM public.organization_financial_records
    WHERE deleted_at IS NULL
      AND (v_period_start IS NULL OR transaction_date >= v_period_start)
      AND (v_period_end IS NULL OR transaction_date <= v_period_end);
  ELSE
    v_period_income := v_all_income;
    v_period_expenses := v_all_expenses;
    SELECT
      COUNT(*) FILTER (WHERE category::text = 'income'),
      COUNT(*) FILTER (WHERE category::text = 'expense')
    INTO v_income_count, v_expense_count
    FROM public.organization_financial_records
    WHERE deleted_at IS NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'category', category.category,
        'total', to_char(COALESCE(SUM(record.amount), 0), 'FM999999999999999999999999999999990.00'),
        'count', COUNT(record.id),
        'percentage', CASE
          WHEN COALESCE(SUM(SUM(record.amount)) OVER (), 0) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(record.amount), 0) * 100
            / SUM(SUM(record.amount)) OVER (),
            2
          )
        END
      )
      ORDER BY category.category
    ),
    '[]'::jsonb
  )
  INTO v_breakdown
  FROM (VALUES ('income'::text), ('expense'::text)) AS category(category)
  LEFT JOIN public.organization_financial_records AS record
    ON record.category::text = category.category
    AND record.deleted_at IS NULL
    AND (NOT v_has_period OR v_period_start IS NULL OR record.transaction_date >= v_period_start)
    AND (NOT v_has_period OR v_period_end IS NULL OR record.transaction_date <= v_period_end)
  GROUP BY category.category;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month', to_char(month_bucket.month_start, 'YYYY-MM'),
        'total_income', to_char(COALESCE(month_totals.total_income, 0), 'FM999999999999999999999999999999990.00'),
        'total_expenses', to_char(COALESCE(month_totals.total_expenses, 0), 'FM999999999999999999999999999999990.00')
      )
      ORDER BY month_bucket.month_start
    ),
    '[]'::jsonb
  )
  INTO v_trend
  FROM generate_series(
    date_trunc('month', CURRENT_DATE) - (v_months - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE),
    interval '1 month'
  ) AS month_bucket(month_start)
  LEFT JOIN (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(SUM(amount) FILTER (WHERE category::text = 'income'), 0) AS total_income,
      COALESCE(SUM(amount) FILTER (WHERE category::text = 'expense'), 0) AS total_expenses
    FROM public.organization_financial_records
    WHERE deleted_at IS NULL
      AND transaction_date >= date_trunc('month', CURRENT_DATE) - (v_months - 1) * interval '1 month'
      AND transaction_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
    GROUP BY date_trunc('month', transaction_date)::date
  ) AS month_totals
    ON month_totals.month_start = month_bucket.month_start::date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'amount', to_char(recent.amount, 'FM999999999999999999999999999999990.00'),
        'category', recent.category,
        'purpose', recent.purpose,
        'counterparty', recent.counterparty,
        'transaction_date', recent.transaction_date,
        'created_at', recent.created_at,
        'has_document', recent.document_path IS NOT NULL
      )
      ORDER BY recent.created_at DESC, recent.id
    ),
    '[]'::jsonb
  )
  INTO v_recent_records
  FROM (
    SELECT id, amount, category, purpose, counterparty, transaction_date, created_at, document_path
    FROM public.organization_financial_records
    WHERE deleted_at IS NULL
      AND (NOT v_has_period OR v_period_start IS NULL OR transaction_date >= v_period_start)
      AND (NOT v_has_period OR v_period_end IS NULL OR transaction_date <= v_period_end)
    ORDER BY created_at DESC, id
    LIMIT 10
  ) AS recent;

  RETURN jsonb_build_object(
    'period', v_period,
    'all_time', jsonb_build_object(
      'total_income', to_char(v_all_income, 'FM999999999999999999999999999999990.00'),
      'total_expenses', to_char(v_all_expenses, 'FM999999999999999999999999999999990.00'),
      'net_balance', to_char(v_all_income - v_all_expenses, 'FM999999999999999999999999999999990.00')
    ),
    'selected_period', CASE WHEN NOT v_has_period THEN NULL ELSE jsonb_build_object(
      'total_income', to_char(v_period_income, 'FM999999999999999999999999999999990.00'),
      'total_expenses', to_char(v_period_expenses, 'FM999999999999999999999999999999990.00'),
      'net_balance', to_char(v_period_income - v_period_expenses, 'FM999999999999999999999999999999990.00'),
      'income_count', v_income_count,
      'expense_count', v_expense_count
    ) END,
    'breakdown_by_category', v_breakdown,
    'monthly_trend', v_trend,
    'recent_records', v_recent_records
  );
END;
$$;
