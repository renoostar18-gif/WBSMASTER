-- The colour theme a person chose (an id such as 'ocean'; null = the default). The app ignores ids it does not know.
alter table users add column palette text check (palette is null or palette ~ '^[a-z][a-z0-9-]{1,30}$');
