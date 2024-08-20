export interface Pagination {
  total: number;
  page: number;
  pages: number;
  prev: number | null;
  next: number | null;
  limit: number;

  // latest created_at of the matching data set
  until: number;
}
