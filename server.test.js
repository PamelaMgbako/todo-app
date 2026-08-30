const request = require("supertest");
const app = require("./server");

describe("Todo App", () => {
  test("GET / redirects to /login when not authenticated", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  test("GET /login returns the login page", async () => {
    const res = await request(app).get("/login");
    expect(res.statusCode).toBe(200);
  });

  test("GET /signup returns the signup page", async () => {
    const res = await request(app).get("/signup");
    expect(res.statusCode).toBe(200);
  });

  test("GET /dashboard redirects to /login when not authenticated", async () => {
    const res = await request(app).get("/dashboard");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  test("GET /nonexistent-page returns 404", async () => {
    const res = await request(app).get("/nonexistent-page");
    expect(res.statusCode).toBe(404);
  });
});

afterAll(async () => {
  const mongoose = require("mongoose");
  await mongoose.connection.close();
});