use reqwest::{Client, header::{HeaderMap, HeaderValue}};
use serde_json::Value;

pub struct DbClient {
    client: Client,
    url: String,
    key: String,
}

impl DbClient {
    pub fn new(url: &str, key: &str) -> Self {
        DbClient {
            client: Client::new(),
            url: url.trim_end_matches('/').to_string(),
            key: key.to_string(),
        }
    }

    fn base(&self, table: &str) -> String {
        format!("{}/rest/v1/{}", self.url, table)
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("apikey", HeaderValue::from_str(&self.key).unwrap());
        h.insert("Authorization", HeaderValue::from_str(&format!("Bearer {}", self.key)).unwrap());
        h
    }

    pub async fn select(&self, table: &str, query: &str) -> Result<Vec<Value>, String> {
        let url = if query.is_empty() {
            self.base(table)
        } else {
            format!("{}?{}", self.base(table), query)
        };
        let resp = self.client.get(&url)
            .headers(self.headers())
            .send().await.map_err(|e| e.to_string())?;
        let json: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
        Ok(json)
    }

    pub async fn select_one(&self, table: &str, query: &str) -> Result<Option<Value>, String> {
        let mut rows = self.select(table, query).await?;
        Ok(if rows.is_empty() { None } else { Some(rows.remove(0)) })
    }

    pub async fn insert(&self, table: &str, body: Value) -> Result<(), String> {
        let resp = self.client.post(self.base(table))
            .headers(self.headers())
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("insert {}: {}", table, resp.text().await.unwrap_or_default()));
        }
        Ok(())
    }

    pub async fn update(&self, table: &str, filter: &str, body: Value) -> Result<(), String> {
        let url = format!("{}?{}", self.base(table), filter);
        let resp = self.client.patch(&url)
            .headers(self.headers())
            .header("Content-Type", "application/json")
            .json(&body)
            .send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("update {}: {}", table, resp.text().await.unwrap_or_default()));
        }
        Ok(())
    }

    pub async fn delete(&self, table: &str, filter: &str) -> Result<(), String> {
        let url = format!("{}?{}", self.base(table), filter);
        let resp = self.client.delete(&url)
            .headers(self.headers())
            .send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("delete {}: {}", table, resp.text().await.unwrap_or_default()));
        }
        Ok(())
    }
}
