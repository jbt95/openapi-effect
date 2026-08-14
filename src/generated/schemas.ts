import { Schema } from "effect";

export const Cat = Schema.StructWithRest(Schema.Struct({
    type: Schema.Literals(["cat"]),
    meows: Schema.Boolean
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type Cat = typeof Cat.Type;

export const Dog = Schema.StructWithRest(Schema.Struct({
    type: Schema.Literals(["dog"]),
    barks: Schema.Boolean
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type Dog = typeof Dog.Type;

export const Error = Schema.StructWithRest(Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.String)
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type Error = typeof Error.Type;

export const Note = Schema.StructWithRest(Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    meta: Schema.optional(Schema.Record(Schema.String, Schema.Union([]))),
    tags: Schema.optional(Schema.Array(Schema.String))
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type Note = typeof Note.Type;

export const SearchRequest = Schema.StructWithRest(Schema.Struct({
    term: Schema.String,
    filter: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())]))),
    tags: Schema.optional(Schema.Array(Schema.String)),
    status: Schema.optional(Schema.Literals(["active", "disabled", "pending"])),
    range: Schema.optional(Schema.StructWithRest(Schema.Struct({
      min: Schema.optional(Schema.Number),
      max: Schema.optional(Schema.Number)
    }), [Schema.Record(Schema.String, Schema.Unknown)]))
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type SearchRequest = typeof SearchRequest.Type;

export const SearchResponse = Schema.StructWithRest(Schema.Struct({
    results: Schema.Array(Schema.StructWithRest(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isInt()))),
      status: Schema.Literals(["active", "disabled", "pending"]),
      tags: Schema.optional(Schema.Array(Schema.String)),
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      preferences: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
    }), [Schema.Record(Schema.String, Schema.Unknown)])),
    next: Schema.optional(Schema.NullOr(Schema.String)),
    facets: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String)))
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type SearchResponse = typeof SearchResponse.Type;

export const UpdateUserRequest = Schema.StructWithRest(Schema.Struct({
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isInt()))),
    status: Schema.optional(Schema.Literals(["active", "disabled", "pending"]))
  }), [Schema.Record(Schema.String, Schema.Union([]))]);

export type UpdateUserRequest = typeof UpdateUserRequest.Type;

export const User = Schema.StructWithRest(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isInt()))),
    status: Schema.Literals(["active", "disabled", "pending"]),
    tags: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    preferences: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }), [Schema.Record(Schema.String, Schema.Unknown)]);

export type User = typeof User.Type;
