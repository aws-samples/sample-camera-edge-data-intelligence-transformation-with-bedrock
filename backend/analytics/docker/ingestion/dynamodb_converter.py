"""
DynamoDB形式からPython標準のdict形式への変換モジュール
"""


def convert_dynamodb_to_dict(dynamodb_item):
    """
    DynamoDB形式のアイテムをPython dictに変換
    
    Args:
        dynamodb_item: DynamoDB形式のアイテム
            例: {'S': 'value'}, {'N': '123'}, {'BOOL': True}
    
    Returns:
        dict: Python標準のdict
    
    Examples:
        >>> convert_dynamodb_to_dict({'detect_log_id': {'S': 'test-001'}})
        {'detect_log_id': 'test-001'}
        
        >>> convert_dynamodb_to_dict({'count': {'N': '123'}})
        {'count': 123}
        
        >>> convert_dynamodb_to_dict({'enabled': {'BOOL': True}})
        {'enabled': True}
    """
    if not isinstance(dynamodb_item, dict):
        return dynamodb_item
    
    result = {}
    
    for key, value in dynamodb_item.items():
        if not isinstance(value, dict):
            result[key] = value
            continue
        
        # DynamoDBのデータ型を判定して変換
        if 'S' in value:  # String
            result[key] = value['S']
        elif 'N' in value:  # Number
            # 整数か小数かを判定
            num_str = value['N']
            if '.' in num_str:
                result[key] = float(num_str)
            else:
                result[key] = int(num_str)
        elif 'BOOL' in value:  # Boolean
            result[key] = value['BOOL']
        elif 'NULL' in value:  # Null
            result[key] = None
        elif 'M' in value:  # Map
            result[key] = convert_dynamodb_to_dict(value['M'])
        elif 'L' in value:  # List
            result[key] = [convert_dynamodb_to_dict(item) if isinstance(item, dict) else item for item in value['L']]
        elif 'SS' in value:  # String Set
            result[key] = value['SS']
        elif 'NS' in value:  # Number Set
            result[key] = [float(n) if '.' in n else int(n) for n in value['NS']]
        elif 'BS' in value:  # Binary Set
            result[key] = value['BS']
        else:
            # その他の型（通常はここには来ない）
            result[key] = value
    
    return result

