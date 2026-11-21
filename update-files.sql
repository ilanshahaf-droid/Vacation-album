-- אלבום החופשות: צירוף קבצים (תמונות, PDF, מסמכים) למקומות, מסעדות, אתרים ואטרקציות.
-- להריץ פעם אחת ב-Supabase (פרויקט Down-to-the-bone) → SQL Editor.
-- מאפשר כל סוג קובץ בתיקיית האלבום, עד 10MB לקובץ (ההרשאות לפי בעל האלבום נשארות כמו שהן).
update storage.buckets
   set allowed_mime_types = null,
       file_size_limit    = 10485760
 where id = 'album-photos';
