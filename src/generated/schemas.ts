import { Schema } from "effect";

export const Cat = Schema.Struct({
    type: Schema.Literal("cat"),
    meows: Schema.Boolean
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type Cat = typeof Cat.Type;

export const Dog = Schema.Struct({
    type: Schema.Literal("dog"),
    barks: Schema.Boolean
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type Dog = typeof Dog.Type;

export const Error = Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.String)
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type Error = typeof Error.Type;

export const Note = Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    meta: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Union() })),
    tags: Schema.optional(Schema.Array(Schema.String))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type Note = typeof Note.Type;

export const SearchRequest = Schema.Struct({
    term: Schema.String,
    filter: Schema.optional(Schema.NullOr(Schema.Union(Schema.String, Schema.Number.pipe(Schema.int())))),
    tags: Schema.optional(Schema.Array(Schema.String)),
    status: Schema.optional(Schema.Literal("active", "disabled", "pending")),
    range: Schema.optional(Schema.Struct({
      min: Schema.optional(Schema.Number),
      max: Schema.optional(Schema.Number)
    }, Schema.Record({ key: Schema.String, value: Schema.Unknown })))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type SearchRequest = typeof SearchRequest.Type;

export const SearchResponse = Schema.Struct({
    results: Schema.Array(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
      status: Schema.Literal("active", "disabled", "pending"),
      tags: Schema.optional(Schema.Array(Schema.String)),
      metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
      preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
    }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
    next: Schema.optional(Schema.NullOr(Schema.String)),
    facets: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type SearchResponse = typeof SearchResponse.Type;

export const UpdateUserRequest = Schema.Struct({
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
    status: Schema.optional(Schema.Literal("active", "disabled", "pending"))
  }, Schema.Record({ key: Schema.String, value: Schema.Union() }));

export type UpdateUserRequest = typeof UpdateUserRequest.Type;

export const User = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
    status: Schema.Literal("active", "disabled", "pending"),
    tags: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

export type User = typeof User.Type;
