import pandas as pd
import numpy as np
from faker import Faker
from datetime import datetime, timedelta, date
import random
import uuid
from typing import List, Dict

class CampaignGenerator:
    def __init__(self, seed: int = 42):
        self.fake = Faker()
        Faker.seed(seed)
        random.seed(seed)
        np.random.seed(seed)
        
        self.industries = {
            'Technology': 0.20,
            'Retail': 0.15,
            'Automotive': 0.15,
            'Financial Services': 0.10,
            'Healthcare': 0.08,
            'Food & Beverage': 0.12,
            'Entertainment': 0.08,
            'Travel': 0.07,
            'Fashion': 0.05
        }
        
        self.campaign_types = {
            'brand_awareness': 0.35,
            'conversion': 0.40,
            'retention': 0.25
        }
        
        self.objectives = {
            'brand_awareness': ['Increase brand recognition', 'Build brand equity', 'Reach new audiences'],
            'conversion': ['Drive sales', 'Generate leads', 'Increase app downloads', 'Boost subscriptions'],
            'retention': ['Reduce churn', 'Increase engagement', 'Promote loyalty program']
        }
        
        self.ad_formats = {
            'video': 0.60,
            'display': 0.25,
            'interactive': 0.15
        }
        
        self.ad_durations = {
            'video': [15, 30, 60],
            'display': [0],
            'interactive': [30, 45, 60]
        }
        
        self.placement_types = {
            'pre-roll': 0.50,
            'mid-roll': 0.30,
            'post-roll': 0.20
        }
        
        self.age_groups = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
        self.genders = ['Male', 'Female', 'All']
        self.countries = ['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'All']
        self.genres = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'All']
        self.subscription_tiers = ['free_with_ads', 'basic', 'All']
        
        self.company_names = [
            'TechCorp', 'MegaRetail', 'AutoDrive', 'FinanceFirst', 'HealthPlus',
            'FoodDelight', 'EntertainMax', 'TravelEasy', 'FashionForward', 'SportsPro',
            'BeautyGlow', 'HomeComfort', 'EduLearn', 'GreenEnergy', 'CryptoTrade'
        ]
    
    def generate_campaign(self, campaign_index: int) -> Dict:
        campaign_id = f"CAMP_{str(uuid.uuid4())[:8]}_{campaign_index:06d}"
        advertiser_id = f"ADV_{str(uuid.uuid4())[:8]}"
        
        industry = np.random.choice(
            list(self.industries.keys()),
            p=list(self.industries.values())
        )
        
        campaign_type = np.random.choice(
            list(self.campaign_types.keys()),
            p=list(self.campaign_types.values())
        )
        
        objective = random.choice(self.objectives[campaign_type])
        
        campaign_duration = random.randint(7, 90)
        start_date = self.fake.date_between(start_date='-6m', end_date='today')
        end_date = start_date + timedelta(days=campaign_duration)
        
        today = date.today()
        if end_date < today:
            status = 'completed'
        elif start_date > today:
            status = 'scheduled'
        else:
            status = 'active'
        
        if campaign_type == 'brand_awareness':
            daily_budget = random.uniform(1000, 10000)
        elif campaign_type == 'conversion':
            daily_budget = random.uniform(2000, 20000)
        else:
            daily_budget = random.uniform(500, 5000)
        
        total_budget = daily_budget * campaign_duration
        
        if status == 'completed':
            spent_amount = total_budget * random.uniform(0.85, 1.0)
            days_run = campaign_duration
        elif status == 'active':
            days_run = (today - start_date).days
            spent_amount = daily_budget * days_run * random.uniform(0.9, 1.1)
        else:
            spent_amount = 0
            days_run = 0
        
        target_age_groups = self._select_targets(self.age_groups, 0.6)
        target_genders = self._select_targets(self.genders, 0.7)
        target_countries = self._select_targets(self.countries, 0.5)
        target_genres = self._select_targets(self.genres, 0.4)
        target_subscription_tiers = ['free_with_ads'] if random.random() < 0.9 else self._select_targets(self.subscription_tiers, 0.5)
        
        ad_format = np.random.choice(
            list(self.ad_formats.keys()),
            p=list(self.ad_formats.values())
        )
        
        ad_duration_seconds = random.choice(self.ad_durations[ad_format])
        
        placement_type = np.random.choice(
            list(self.placement_types.keys()),
            p=list(self.placement_types.values())
        )
        
        advertiser_name = f"{random.choice(self.company_names)} {industry}"
        campaign_name = f"{advertiser_name} - {objective} - Q{((start_date.month-1)//3)+1} {start_date.year}"
        
        if status in ['completed', 'active']:
            performance = self._generate_performance_metrics(
                campaign_type, spent_amount, days_run, ad_format
            )
        else:
            performance = self._generate_empty_performance()
        
        return {
            'campaign_id': campaign_id,
            'campaign_name': campaign_name,
            'advertiser_id': advertiser_id,
            'advertiser_name': advertiser_name,
            'industry': industry,
            'campaign_type': campaign_type,
            'objective': objective,
            'start_date': start_date,
            'end_date': end_date,
            'status': status,
            'daily_budget': round(daily_budget, 2),
            'total_budget': round(total_budget, 2),
            'spent_amount': round(spent_amount, 2),
            'target_age_groups': target_age_groups,
            'target_genders': target_genders,
            'target_countries': target_countries,
            'target_genres': target_genres,
            'target_subscription_tiers': target_subscription_tiers,
            'ad_format': ad_format,
            'ad_duration_seconds': ad_duration_seconds,
            'placement_type': placement_type,
            'creative_url': f"https://cdn.acmecorp.com/ads/{campaign_id}/creative.mp4",
            'landing_page_url': f"https://track.acmecorp.com/click/{campaign_id}",
            **performance,
            'created_at': self.fake.date_time_between(start_date=start_date - timedelta(days=7), end_date=start_date),
            'updated_at': self.fake.date_time_between(start_date=start_date, end_date='now')
        }
    
    def generate_campaigns(self, num_campaigns: int) -> pd.DataFrame:
        campaigns = []
        for i in range(num_campaigns):
            campaigns.append(self.generate_campaign(i))
        
        df = pd.DataFrame(campaigns)
        return df
    
    def _select_targets(self, options: List[str], all_probability: float) -> List[str]:
        if 'All' in options and random.random() < all_probability:
            return ['All']
        
        non_all_options = [opt for opt in options if opt != 'All']
        num_targets = random.randint(1, min(3, len(non_all_options)))
        return random.sample(non_all_options, k=num_targets)
    
    def _generate_performance_metrics(self, campaign_type: str, spent_amount: float, 
                                    days_run: int, ad_format: str) -> Dict:
        
        if campaign_type == 'brand_awareness':
            cpm_base = random.uniform(5, 15)
            ctr_base = random.uniform(0.001, 0.005)
            conversion_rate_base = random.uniform(0.0001, 0.0005)
        elif campaign_type == 'conversion':
            cpm_base = random.uniform(10, 25)
            ctr_base = random.uniform(0.005, 0.02)
            conversion_rate_base = random.uniform(0.001, 0.01)
        else:
            cpm_base = random.uniform(8, 20)
            ctr_base = random.uniform(0.003, 0.01)
            conversion_rate_base = random.uniform(0.0005, 0.005)
        
        if ad_format == 'video':
            ctr_multiplier = 1.2
            vtr_base = random.uniform(0.6, 0.9)
        elif ad_format == 'interactive':
            ctr_multiplier = 1.5
            vtr_base = random.uniform(0.7, 0.95)
        else:
            ctr_multiplier = 0.8
            vtr_base = 1.0
        
        cpm = cpm_base * random.uniform(0.8, 1.2)
        impressions = int(spent_amount / cpm * 1000)
        
        unique_viewers = int(impressions * random.uniform(0.6, 0.9))
        
        ctr = ctr_base * ctr_multiplier * random.uniform(0.8, 1.2)
        clicks = int(impressions * ctr)
        
        conversion_rate = conversion_rate_base * random.uniform(0.8, 1.2)
        conversions = int(clicks * conversion_rate * 10)
        
        cpc = spent_amount / clicks if clicks > 0 else 0
        cost_per_conversion = spent_amount / conversions if conversions > 0 else 0
        
        return {
            'impressions': impressions,
            'unique_viewers': unique_viewers,
            'clicks': clicks,
            'conversions': conversions,
            'view_through_rate': round(vtr_base, 4),
            'click_through_rate': round(ctr, 4),
            'conversion_rate': round(conversion_rate, 4),
            'cost_per_mille': round(cpm, 2),
            'cost_per_click': round(cpc, 2),
            'cost_per_conversion': round(cost_per_conversion, 2)
        }
    
    def _generate_empty_performance(self) -> Dict:
        return {
            'impressions': 0,
            'unique_viewers': 0,
            'clicks': 0,
            'conversions': 0,
            'view_through_rate': 0.0,
            'click_through_rate': 0.0,
            'conversion_rate': 0.0,
            'cost_per_mille': 0.0,
            'cost_per_click': 0.0,
            'cost_per_conversion': 0.0
        }